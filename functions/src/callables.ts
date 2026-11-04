import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  activeLessonBlocks,
  CreateDailyLessonRequestSchema,
  InitializeProfileRequestSchema,
  isStaleUnenqueuedLesson,
  LessonIdRequestSchema,
  RegisterPushDeviceRequestSchema,
  SetTelemetryConsentRequestSchema,
  UpdateReminderRequestSchema,
} from "@resolingo/shared";
import { DAILY_LIMIT, DELETE_ACCOUNT_TIMEOUT_SECONDS, REGION } from "./config.js";
import { requireUid } from "./auth.js";
import { auth, bucket, db } from "./firebase.js";
import { abandonUnenqueuedLesson, enqueueLesson } from "./jobs.js";
import { nextReminderAt, localDate, assertTimezone } from "./time.js";
import { tokenHash } from "./push.js";
import { reserveLesson, withoutReservation } from "./quota.js";

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
      nextReservations = reserveLesson(readyCount, reservations, lessonId, DAILY_LIMIT);
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
      nextReservations = reserveLesson(Number(usage.readyCount ?? 0), withoutReservation(usage.reservations, stale?.lessonId), parsed.data.lessonId, DAILY_LIMIT);
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
