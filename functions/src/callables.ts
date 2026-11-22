import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  activeLessonBlocks,
  CefrLevelSchema,
  CreateDailyLessonRequestSchema,
  CreatePhraseLessonRequestSchema,
  InitializeProfileRequestSchema,
  isStaleUnenqueuedLesson,
  lessonCanBeDeleted,
  LanguageIdSchema,
  type LanguageId,
  LessonIdRequestSchema,
  MAX_STORED_PHRASES,
  phraseIdFor,
  phraseLookupLimit,
  reusablePhraseLesson,
  RegisterPushDeviceRequestSchema,
  SetTelemetryConsentRequestSchema,
  TranslatePhraseRequestSchema,
  UpdateReminderRequestSchema,
} from "@resolingo/shared";
import { DAILY_LIMIT, DELETE_ACCOUNT_TIMEOUT_SECONDS, REGION } from "./config.js";
import { requireUid } from "./auth.js";
import { auth, bucket, db } from "./firebase.js";
import { abandonUnenqueuedLesson, enqueueLesson } from "./jobs.js";
import { nextReminderAt, localDate, assertTimezone } from "./time.js";
import { tokenHash } from "./push.js";
import { dailyReservationLimit, reserveLesson, withoutReservation } from "./quota.js";
import { transcribeWithSpeechToText } from "./stt.js";
import { PhraseTranslationError, transcribePhraseAudio, translatePhraseContent, translateSpokenPhrase, type PhraseTranslation } from "./translate.js";
import { vertexProjectId } from "./gemini.js";
import { synthesizePhrasePreview } from "./tts.js";
import type { ZodError } from "zod";

function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("toMillis" in value) || typeof value.toMillis !== "function") return null;
  const millis = value.toMillis();
  return typeof millis === "number" ? millis : null;
}

async function inspectActiveLesson(
  transaction: Transaction,
  uid: string,
  activeLessonId: unknown,
  nowMs: number,
): Promise<{ lessonId: string; quotaDate: string } | null> {
  if (typeof activeLessonId !== "string" || !activeLessonId) return null;
  const activeSnap = await transaction.get(db.doc(`users/${uid}/lessons/${activeLessonId}`));
  const data = activeSnap.data();
  const lock = {
    status: typeof data?.status === "string" ? data.status : null,
    enqueuePending: data?.enqueuePending === true,
    updatedAtMs: timestampMillis(data?.updatedAt),
    nowMs,
  };
  if (activeLessonBlocks(lock)) throw new HttpsError("failed-precondition", "Another lesson is being generated.");
  if (!isStaleUnenqueuedLesson(lock)) return null;
  return { lessonId: activeLessonId, quotaDate: typeof data?.quotaDate === "string" ? data.quotaDate : "" };
}

async function enqueueOrRollBack(uid: string, lessonId: string, quotaDate: string): Promise<void> {
  try {
    await enqueueLesson({ uid, lessonId });
  } catch (error) {
    logger.error("enqueue_failed", { lessonId, message: error instanceof Error ? error.message : "enqueue_failed" });
    await abandonUnenqueuedLesson(uid, lessonId, quotaDate, "queue_unavailable").catch(() => {
      logger.error("enqueue_rollback_failed", { lessonId });
    });
    throw new HttpsError("unavailable", "Lesson generation is temporarily unavailable.");
  }
  const patch = {
    enqueuePending: FieldValue.delete(),
    enqueuedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  try {
    await db.doc(`users/${uid}/lessons/${lessonId}`).update(patch);
  } catch (error) {
    logger.error("enqueue_stamp_failed", { lessonId, message: error instanceof Error ? error.message : "enqueue_stamp_failed" });
    await db.doc(`users/${uid}/lessons/${lessonId}`).update(patch).catch(() => {
      logger.error("enqueue_stamp_retry_failed", { lessonId });
    });
  }
}

const callableOptions = { region: REGION, enforceAppCheck: true } as const;

export const initializeProfile = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = InitializeProfileRequestSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  assertTimezone(parsed.data.timezone);
  if (parsed.data.nativeLanguage === parsed.data.targetLanguage) {
    throw new HttpsError("invalid-argument", "Choose two different languages.");
  }
  const user = await auth.getUser(uid);
  const profileSnapshot = await db.doc(`users/${uid}`).get();
  await db.doc(`users/${uid}`).set({
    ...parsed.data,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    onboardingComplete: true,
    reminderNextAt: parsed.data.reminderEnabled
      ? Timestamp.fromDate(nextReminderAt(parsed.data.timezone, parsed.data.reminderTime))
      : null,
    ...(!profileSnapshot.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true };
});

export const createDailyLesson = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = CreateDailyLessonRequestSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const lessonId = parsed.data.idempotencyKey;
  const userRef = db.doc(`users/${uid}`);
  const lessonRef = db.doc(`users/${uid}/lessons/${lessonId}`);
  let quotaDate = "";
  let alreadyExists = false;
  const nowMs = Date.now();

  await db.runTransaction(async (transaction) => {
    const [userSnapshot, lessonSnapshot] = await Promise.all([
      transaction.get(userRef), transaction.get(lessonRef),
    ]);
    if (lessonSnapshot.exists) {
      alreadyExists = true;
      quotaDate = lessonSnapshot.data()!.quotaDate as string;
      return;
    }
    const profile = userSnapshot.data();
    if (!profile?.onboardingComplete) throw new HttpsError("failed-precondition", "Complete onboarding first.");
    if (profile.deletionRequested) throw new HttpsError("failed-precondition", "Account deletion is in progress.");
    const stale = await inspectActiveLesson(transaction, uid, profile.activeLessonId, nowMs);
    quotaDate = localDate(profile.timezone as string);
    const usageRef = db.doc(`users/${uid}/dailyUsage/${quotaDate}`);
    const usageSnapshot = await transaction.get(usageRef);
    const staleUsage = stale?.quotaDate && stale.quotaDate !== quotaDate
      ? await transaction.get(db.doc(`users/${uid}/dailyUsage/${stale.quotaDate}`))
      : null;
    if (stale) {
      transaction.update(db.doc(`users/${uid}/lessons/${stale.lessonId}`), {
        status: "failed",
        progress: 0,
        failureCode: "enqueue_timeout",
        enqueuePending: FieldValue.delete(),
        failedAt: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (staleUsage?.exists) {
        transaction.set(staleUsage.ref, {
          reservations: withoutReservation(staleUsage.data()?.reservations, stale.lessonId),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
    const usage = usageSnapshot.data() ?? {};
    const reservations = withoutReservation(usage.reservations, stale?.lessonId);
    const readyCount = Number(usage.readyCount ?? 0);
    let nextReservations: string[];
    try {
      nextReservations = reserveLesson(
        readyCount,
        reservations,
        lessonId,
        dailyReservationLimit(profile.unlimitedLessons, DAILY_LIMIT),
      );
    } catch {
      throw new HttpsError("resource-exhausted", "Daily lesson limit reached.");
    }
    transaction.set(lessonRef, {
      id: lessonId,
      type: parsed.data.type,
      status: "queued",
      enqueuePending: true,
      progress: 5,
      quotaDate,
      title: "Preparing your lesson",
      topic: "",
      summary: "",
      segments: [],
      completed: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(usageRef, {
      readyCount,
      reservations: nextReservations,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(userRef, { activeLessonId: lessonId, updatedAt: FieldValue.serverTimestamp() });
  });

  if (!alreadyExists) await enqueueOrRollBack(uid, lessonId, quotaDate);
  return { lessonId, alreadyExists };
});

function translateRequestError(error: ZodError): HttpsError {
  const spoken = error.issues.find((issue) => (
    issue.message === "That recording is too long."
    || issue.message === "That recording format is not supported."
    || issue.message === "That recording could not be read."
    || issue.message === "Didn't catch that. Try again."
    || issue.message === "Keep it under 15 seconds."
    || issue.message === "Record a short sentence."
  ));
  if (spoken) return new HttpsError("invalid-argument", spoken.message);
  if (error.issues.some((issue) => issue.code === "too_big" && issue.path.includes("audioBase64"))) {
    return new HttpsError("invalid-argument", "That recording is too long.");
  }
  if (error.issues.some((issue) => issue.code === "too_big")) {
    return new HttpsError("invalid-argument", "Keep it to one short sentence.");
  }
  return new HttpsError("invalid-argument", "Type a sentence you want to say.");
}

function translationFailure(error: unknown): HttpsError {
  if (error instanceof PhraseTranslationError && error.code === "silent") {
    return new HttpsError("invalid-argument", "Didn't catch that. Try again.");
  }
  if (error instanceof PhraseTranslationError && (error.code === "rejected" || error.code === "blocked")) {
    return new HttpsError("invalid-argument", "That doesn't look like a sentence to translate.");
  }
  logger.warn("phrase_translation_failed", { code: error instanceof PhraseTranslationError ? error.code : "unavailable" });
  return new HttpsError("unavailable", "Translation is temporarily unavailable.");
}

type StoredPhrase = PhraseTranslation & { audioPath?: string; lessonId?: string };

function storedPhrase(id: string, value: DocumentData | undefined): StoredPhrase | null {
  const nativeText = typeof value?.nativeText === "string" ? value.nativeText : "";
  const translation = typeof value?.translation === "string" ? value.translation : "";
  const inputLanguage = value?.inputLanguage === "target" || value?.inputLanguage === "mixed" || value?.inputLanguage === "unknown"
    ? value.inputLanguage
    : "native";
  if (!nativeText || !translation) return null;
  const alternatives = Array.isArray(value?.alternatives)
    ? value.alternatives.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as { label?: unknown; text?: unknown; transliteration?: unknown };
      if (typeof record.label !== "string" || typeof record.text !== "string") return [];
      return [{
        label: record.label,
        text: record.text,
        ...(typeof record.transliteration === "string" && record.transliteration ? { transliteration: record.transliteration } : {}),
      }];
    })
    : [];
  return {
    phraseId: id,
    nativeText,
    translation,
    inputLanguage,
    alternatives,
    ...(typeof value?.transliteration === "string" && value.transliteration ? { transliteration: value.transliteration } : {}),
    ...(typeof value?.note === "string" && value.note ? { note: value.note } : {}),
    ...(typeof value?.audioPath === "string" && value.audioPath ? { audioPath: value.audioPath } : {}),
    ...(typeof value?.lessonId === "string" && value.lessonId ? { lessonId: value.lessonId } : {}),
  };
}

function phraseResponse(phrase: StoredPhrase) {
  return {
    phraseId: phrase.phraseId,
    nativeText: phrase.nativeText,
    translation: phrase.translation,
    inputLanguage: phrase.inputLanguage,
    alternatives: phrase.alternatives,
    ...(phrase.transliteration ? { transliteration: phrase.transliteration } : {}),
    ...(phrase.note ? { note: phrase.note } : {}),
    ...(phrase.audioPath ? { audioPath: phrase.audioPath } : {}),
    ...(phrase.lessonId ? { lessonId: phrase.lessonId } : {}),
  };
}

async function attachPreview(uid: string, phrase: StoredPhrase, level: string, language: LanguageId): Promise<StoredPhrase> {
  if (phrase.audioPath) return phrase;
  try {
    const audioPath = await synthesizePhrasePreview({
      uid,
      phraseId: phrase.phraseId,
      text: phrase.translation,
      language,
      level,
    });
    await db.doc(`users/${uid}/phrases/${phrase.phraseId}`).set({
      audioPath,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ...phrase, audioPath };
  } catch (error) {
    logger.warn("phrase_preview_failed", { phraseId: phrase.phraseId, message: error instanceof Error ? error.message.slice(0, 160) : "tts" });
    throw new HttpsError("unavailable", "Translation is temporarily unavailable.");
  }
}

async function assertPhraseQuota(uid: string, profile: DocumentData): Promise<{ usageRef: DocumentReference; limit: number }> {
  const usageRef = db.doc(`users/${uid}/dailyUsage/${localDate(profile.timezone as string)}`);
  const usage = (await usageRef.get()).data() ?? {};
  const limit = phraseLookupLimit(profile.unlimitedLessons);
  if (Number(usage.phraseLookups ?? 0) >= limit) {
    throw new HttpsError("resource-exhausted", "You've reached today's phrase lookups.");
  }
  return { usageRef, limit };
}

async function chargePhraseLookup(usageRef: DocumentReference, limit: number): Promise<void> {
  const charged = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(usageRef);
    const count = Number(current.data()?.phraseLookups ?? 0);
    if (count >= limit) return false;
    transaction.set(usageRef, { phraseLookups: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
  if (!charged) throw new HttpsError("resource-exhausted", "You've reached today's phrase lookups.");
}

export const translatePhrase = onCall({ ...callableOptions, timeoutSeconds: 120 }, async (request) => {
  const uid = requireUid(request);
  const parsed = TranslatePhraseRequestSchema.safeParse(request.data);
  if (!parsed.success) throw translateRequestError(parsed.error);
  const profileSnap = await db.doc(`users/${uid}`).get();
  const profile = profileSnap.data();
  if (!profile?.onboardingComplete) throw new HttpsError("failed-precondition", "Complete onboarding first.");
  if (profile.deletionRequested) throw new HttpsError("failed-precondition", "Account deletion is in progress.");
  const nativeLanguage = LanguageIdSchema.parse(profile.nativeLanguage);
  const targetLanguage = LanguageIdSchema.parse(profile.targetLanguage);
  const level = CefrLevelSchema.parse(profile.level);
  const audio = parsed.data.audioBase64 && parsed.data.mimeType
    ? { audioBase64: parsed.data.audioBase64, mimeType: parsed.data.mimeType }
    : null;
  if (audio && parsed.data.mode === "transcribe") {
    const quota = await assertPhraseQuota(uid, profile);
    let nativeText: string;
    try {
      try {
        nativeText = await transcribeWithSpeechToText({ ...audio, nativeLanguage, projectId: vertexProjectId() });
      } catch (error) {
        if (error instanceof PhraseTranslationError) throw error;
        logger.warn("speech_to_text_fallback", { message: error instanceof Error ? error.message : "stt_failed" });
        nativeText = await transcribePhraseAudio({ ...audio, nativeLanguage });
      }
    } catch (error) {
      throw translationFailure(error);
    }
    await chargePhraseLookup(quota.usageRef, quota.limit);
    return { mode: "transcribe" as const, nativeText };
  }

  let translated: PhraseTranslation;
  let phraseId: string;
  let phraseRef: DocumentReference;
  if (audio) {
    await assertPhraseQuota(uid, profile);
    try {
      translated = await translateSpokenPhrase({ ...audio, nativeLanguage, targetLanguage, level });
    } catch (error) {
      throw translationFailure(error);
    }
    phraseId = translated.phraseId;
    phraseRef = db.doc(`users/${uid}/phrases/${phraseId}`);
    const existing = storedPhrase(phraseId, (await phraseRef.get()).data());
    if (existing) return phraseResponse(await attachPreview(uid, existing, level, targetLanguage));
  } else {
    const text = parsed.data.text ?? "";
    phraseId = phraseIdFor(targetLanguage, level, text, nativeLanguage);
    phraseRef = db.doc(`users/${uid}/phrases/${phraseId}`);
    const existing = storedPhrase(phraseId, (await phraseRef.get()).data());
    if (existing) return phraseResponse(await attachPreview(uid, existing, level, targetLanguage));
    await assertPhraseQuota(uid, profile);
    try {
      translated = await translatePhraseContent({ text, nativeLanguage, targetLanguage, level });
    } catch (error) {
      throw translationFailure(error);
    }
  }

  const quotaDate = localDate(profile.timezone as string);
  const usageRef = db.doc(`users/${uid}/dailyUsage/${quotaDate}`);
  const limit = phraseLookupLimit(profile.unlimitedLessons);

  const outcome = await db.runTransaction(async (transaction) => {
    const [currentPhrase, currentUsage] = await Promise.all([transaction.get(phraseRef), transaction.get(usageRef)]);
    const stored = storedPhrase(phraseId, currentPhrase.data());
    if (stored) return { kind: "exists" as const, phrase: stored };
    const count = Number(currentUsage.data()?.phraseLookups ?? 0);
    if (count >= limit) return { kind: "limit" as const };
    transaction.set(phraseRef, {
      ...translated,
      targetLanguage,
      nativeLanguage,
      level,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(usageRef, { phraseLookups: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { kind: "created" as const, phrase: translated };
  });
  if (outcome.kind === "limit") throw new HttpsError("resource-exhausted", "You've reached today's phrase lookups.");
  const saved = outcome.phrase;
  const withAudio = await attachPreview(uid, saved, level, targetLanguage);
  if (outcome.kind === "created") {
    const extra = await db.collection(`users/${uid}/phrases`).orderBy("createdAt", "desc").offset(MAX_STORED_PHRASES).get();
    if (!extra.empty) {
      const batch = db.batch();
      extra.docs.forEach((item) => batch.delete(item.ref));
      await batch.commit();
    }
  }
  return phraseResponse(withAudio);
});

export const createPhraseLesson = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = CreatePhraseLessonRequestSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "That phrase could not be used for a lesson.");
  const lessonId = parsed.data.idempotencyKey;
  const userRef = db.doc(`users/${uid}`);
  const lessonRef = db.doc(`users/${uid}/lessons/${lessonId}`);
  const phraseRef = db.doc(`users/${uid}/phrases/${parsed.data.phraseId}`);
  let quotaDate = "";
  let alreadyExists = false;
  let resolvedId = lessonId;
  const nowMs = Date.now();

  await db.runTransaction(async (transaction) => {
    const [userSnapshot, lessonSnapshot, phraseSnapshot] = await Promise.all([
      transaction.get(userRef), transaction.get(lessonRef), transaction.get(phraseRef),
    ]);
    const linkedId = typeof phraseSnapshot.data()?.lessonId === "string" ? phraseSnapshot.data()?.lessonId ?? "" : "";
    const linkedSnapshot = linkedId && linkedId !== lessonId
      ? await transaction.get(db.doc(`users/${uid}/lessons/${linkedId}`))
      : linkedId === lessonId ? lessonSnapshot : null;
    const reusable = reusablePhraseLesson(linkedSnapshot ? { id: linkedId, exists: linkedSnapshot.exists } : null);
    if (reusable) {
      alreadyExists = true;
      resolvedId = reusable;
      const quota = linkedSnapshot?.data()?.quotaDate;
      quotaDate = typeof quota === "string" ? quota : "";
      return;
    }
    if (lessonSnapshot.exists) {
      alreadyExists = true;
      quotaDate = lessonSnapshot.data()!.quotaDate as string;
      return;
    }
    const profile = userSnapshot.data();
    const phrase = storedPhrase(parsed.data.phraseId, phraseSnapshot.data());
    if (!profile?.onboardingComplete) throw new HttpsError("failed-precondition", "Complete onboarding first.");
    if (profile.deletionRequested) throw new HttpsError("failed-precondition", "Account deletion is in progress.");
    if (!phrase) throw new HttpsError("not-found", "Translate a phrase before creating a lesson.");
    if (phrase.nativeText && profile.nativeLanguage !== phraseSnapshot.data()?.nativeLanguage) {
      throw new HttpsError("failed-precondition", "That phrase is for a different language pair. Translate it again.");
    }
    if (profile.targetLanguage !== phraseSnapshot.data()?.targetLanguage) {
      throw new HttpsError("failed-precondition", "That phrase is for a different language pair. Translate it again.");
    }
    const stale = await inspectActiveLesson(transaction, uid, profile.activeLessonId, nowMs);
    quotaDate = localDate(profile.timezone as string);
    const usageRef = db.doc(`users/${uid}/dailyUsage/${quotaDate}`);
    const usageSnapshot = await transaction.get(usageRef);
    const staleUsage = stale?.quotaDate && stale.quotaDate !== quotaDate
      ? await transaction.get(db.doc(`users/${uid}/dailyUsage/${stale.quotaDate}`))
      : null;
    if (stale) {
      transaction.update(db.doc(`users/${uid}/lessons/${stale.lessonId}`), {
        status: "failed",
        progress: 0,
        failureCode: "enqueue_timeout",
        enqueuePending: FieldValue.delete(),
        failedAt: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (staleUsage?.exists) {
        transaction.set(staleUsage.ref, {
          reservations: withoutReservation(staleUsage.data()?.reservations, stale.lessonId),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
    const usage = usageSnapshot.data() ?? {};
    const reservations = withoutReservation(usage.reservations, stale?.lessonId);
    const readyCount = Number(usage.readyCount ?? 0);
    let nextReservations: string[];
    try {
      nextReservations = reserveLesson(
        readyCount,
        reservations,
        lessonId,
        dailyReservationLimit(profile.unlimitedLessons, DAILY_LIMIT),
      );
    } catch {
      throw new HttpsError("resource-exhausted", "Daily lesson limit reached.");
    }
    transaction.set(lessonRef, {
      id: lessonId,
      type: "phrase",
      phraseId: parsed.data.phraseId,
      nativeText: phrase.nativeText,
      translation: phrase.translation,
      status: "queued",
      enqueuePending: true,
      progress: 5,
      quotaDate,
      title: phrase.nativeText.slice(0, 90),
      topic: phrase.nativeText.slice(0, 160),
      summary: "",
      segments: [],
      completed: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(usageRef, {
      readyCount,
      reservations: nextReservations,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(userRef, { activeLessonId: lessonId, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(phraseRef, { lessonId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  if (!alreadyExists) await enqueueOrRollBack(uid, resolvedId, quotaDate);
  return { lessonId: resolvedId, alreadyExists };
});

export const retryFailedLesson = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = LessonIdRequestSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const lessonRef = db.doc(`users/${uid}/lessons/${parsed.data.lessonId}`);
  let quotaDate = "";
  const nowMs = Date.now();
  await db.runTransaction(async (transaction) => {
    const userRef = db.doc(`users/${uid}`);
    const [userSnapshot, lessonSnapshot] = await Promise.all([transaction.get(userRef), transaction.get(lessonRef)]);
    if (!lessonSnapshot.exists) throw new HttpsError("not-found", "Lesson not found.");
    if (lessonSnapshot.data()!.status !== "failed") throw new HttpsError("failed-precondition", "Only failed lessons can be retried.");
    const activeLessonId = userSnapshot.data()?.activeLessonId;
    const stale = activeLessonId !== parsed.data.lessonId
      ? await inspectActiveLesson(transaction, uid, activeLessonId, nowMs)
      : null;
    quotaDate = localDate(userSnapshot.data()!.timezone as string);
    const usageRef = db.doc(`users/${uid}/dailyUsage/${quotaDate}`);
    const usageSnapshot = await transaction.get(usageRef);
    const staleUsage = stale?.quotaDate && stale.quotaDate !== quotaDate
      ? await transaction.get(db.doc(`users/${uid}/dailyUsage/${stale.quotaDate}`))
      : null;
    if (stale) {
      transaction.update(db.doc(`users/${uid}/lessons/${stale.lessonId}`), {
        status: "failed",
        progress: 0,
        failureCode: "enqueue_timeout",
        enqueuePending: FieldValue.delete(),
        failedAt: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (staleUsage?.exists) {
        transaction.set(staleUsage.ref, {
          reservations: withoutReservation(staleUsage.data()?.reservations, stale.lessonId),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
    const usage = usageSnapshot.data() ?? {};
    let nextReservations: string[];
    try {
      nextReservations = reserveLesson(
        Number(usage.readyCount ?? 0),
        withoutReservation(usage.reservations, stale?.lessonId),
        parsed.data.lessonId,
        dailyReservationLimit(userSnapshot.data()?.unlimitedLessons, DAILY_LIMIT),
      );
    } catch {
      throw new HttpsError("resource-exhausted", "Daily lesson limit reached.");
    }
    transaction.update(lessonRef, {
      status: "queued",
      enqueuePending: true,
      progress: 5,
      quotaDate,
      failureCode: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(usageRef, { reservations: nextReservations, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.update(userRef, { activeLessonId: parsed.data.lessonId, updatedAt: FieldValue.serverTimestamp() });
  });
  await enqueueOrRollBack(uid, parsed.data.lessonId, quotaDate);
  return { lessonId: parsed.data.lessonId };
});

/**
 * Removes one lesson the learner owns: the lesson document and its audio
 * under users/{uid}/lessons/{lessonId}/. Lessons have no subcollections.
 * Phrase preview audio and the phrase itself stay; only a dangling lessonId
 * pointer is cleared. Review items and dailyUsage are left as they are, so
 * deleting a lesson does not refund the day's ready count or erase practice.
 */
export const deleteLesson = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = LessonIdRequestSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Choose a lesson to delete.");
  const lessonId = parsed.data.lessonId;
  const lessonRef = db.doc(`users/${uid}/lessons/${lessonId}`);
  const snapshot = await lessonRef.get();
  if (!snapshot.exists) return { ok: true };
  const data = snapshot.data() ?? {};
  const status = typeof data.status === "string" ? data.status : "";
  if (!lessonCanBeDeleted(status)) {
    throw new HttpsError("failed-precondition", "This lesson is still being created.");
  }
  const user = await db.doc(`users/${uid}`).get();
  if (user.data()?.activeLessonId === lessonId) {
    throw new HttpsError("failed-precondition", "This lesson is still being created.");
  }
  const phraseId = typeof data.phraseId === "string" ? data.phraseId : "";
  if (phraseId) {
    const phraseRef = db.doc(`users/${uid}/phrases/${phraseId}`);
    const phrase = await phraseRef.get();
    if (phrase.exists && phrase.data()?.lessonId === lessonId) {
      await phraseRef.update({ lessonId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    }
  }
  try {
    await bucket.deleteFiles({ prefix: `users/${uid}/lessons/${lessonId}/` });
  } catch (error) {
    logger.error("lesson_audio_delete_failed", { lessonId, message: error instanceof Error ? error.message : "delete_failed" });
    throw new HttpsError("unavailable", "Couldn’t delete this lesson. Try again.");
  }
  await lessonRef.delete();
  return { ok: true };
});

export const registerPushDevice = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = RegisterPushDeviceRequestSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  await db.doc(`users/${uid}/devices/${tokenHash(parsed.data.expoPushToken)}`).set({
    ...parsed.data,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true };
});

export const updateReminder = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = UpdateReminderRequestSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  assertTimezone(parsed.data.timezone);
  await db.doc(`users/${uid}`).update({
    reminderEnabled: parsed.data.enabled,
    reminderTime: parsed.data.time,
    timezone: parsed.data.timezone,
    reminderNextAt: parsed.data.enabled ? Timestamp.fromDate(nextReminderAt(parsed.data.timezone, parsed.data.time)) : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const setTelemetryConsent = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = SetTelemetryConsentRequestSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  await db.doc(`users/${uid}`).update({ telemetryConsent: parsed.data.enabled, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

export const deleteAccount = onCall({ ...callableOptions, timeoutSeconds: DELETE_ACCOUNT_TIMEOUT_SECONDS }, async (request) => {
  const uid = requireUid(request);
  const profileRef = db.doc(`users/${uid}`);
  await db.runTransaction(async (transaction) => {
    const profile = await transaction.get(profileRef);
    if (!profile.exists) return;
    if (profile.data()?.activeLessonId) {
      throw new HttpsError("failed-precondition", "Wait for the active lesson to finish before deleting your account.");
    }
    transaction.update(profileRef, { deletionRequested: true, updatedAt: FieldValue.serverTimestamp() });
  });
  await Promise.all([
    bucket.deleteFiles({ prefix: `users/${uid}/` }),
    db.recursiveDelete(profileRef),
  ]);
  await auth.deleteUser(uid);
  return { ok: true };
});
