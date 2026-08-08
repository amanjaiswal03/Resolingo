import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  CreateDailyLessonRequestSchema,
  InitializeProfileRequestSchema,
  LessonIdRequestSchema,
  RegisterPushDeviceRequestSchema,
  SetTelemetryConsentRequestSchema,
  UpdateReminderRequestSchema,
} from "@resolingo/shared";
import { DAILY_LIMIT, REGION } from "./config.js";
import { requireUid } from "./auth.js";
import { auth, bucket, db } from "./firebase.js";
import { enqueueLesson, releaseReservation } from "./jobs.js";
import { nextReminderAt, localDate, assertTimezone } from "./time.js";
import { tokenHash } from "./push.js";
import { reserveLesson } from "./quota.js";

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
    if (profile.activeLessonId) throw new HttpsError("failed-precondition", "Another lesson is being generated.");
    quotaDate = localDate(profile.timezone as string);
    const usageRef = db.doc(`users/${uid}/dailyUsage/${quotaDate}`);
    const usageSnapshot = await transaction.get(usageRef);
    const usage = usageSnapshot.data() ?? {};
    const reservations = (usage.reservations ?? []) as string[];
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

  if (!alreadyExists) {
    try {
      await enqueueLesson({ uid, lessonId });
    } catch (error) {
      await lessonRef.update({ status: "failed", progress: 0, failureCode: "queue_unavailable", updatedAt: FieldValue.serverTimestamp() });
      await releaseReservation(uid, lessonId, quotaDate);
      throw new HttpsError("unavailable", "Lesson generation is temporarily unavailable.");
    }
  }
  return { lessonId, alreadyExists };
});

export const retryFailedLesson = onCall(callableOptions, async (request) => {
  const uid = requireUid(request);
  const parsed = LessonIdRequestSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const lessonRef = db.doc(`users/${uid}/lessons/${parsed.data.lessonId}`);
  let quotaDate = "";
  await db.runTransaction(async (transaction) => {
    const userRef = db.doc(`users/${uid}`);
    const [userSnapshot, lessonSnapshot] = await Promise.all([transaction.get(userRef), transaction.get(lessonRef)]);
    if (!lessonSnapshot.exists) throw new HttpsError("not-found", "Lesson not found.");
    if (lessonSnapshot.data()!.status !== "failed") throw new HttpsError("failed-precondition", "Only failed lessons can be retried.");
    if (userSnapshot.data()?.activeLessonId) throw new HttpsError("failed-precondition", "Another lesson is being generated.");
    quotaDate = localDate(userSnapshot.data()!.timezone as string);
    const usageRef = db.doc(`users/${uid}/dailyUsage/${quotaDate}`);
    const usageSnapshot = await transaction.get(usageRef);
    const usage = usageSnapshot.data() ?? {};
    const reservations = (usage.reservations ?? []) as string[];
    let nextReservations: string[];
    try {
      nextReservations = reserveLesson(Number(usage.readyCount ?? 0), reservations, parsed.data.lessonId, DAILY_LIMIT);
    } catch {
      throw new HttpsError("resource-exhausted", "Daily lesson limit reached.");
    }
    transaction.update(lessonRef, { status: "queued", progress: 5, quotaDate, failureCode: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    transaction.set(usageRef, { reservations: nextReservations, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.update(userRef, { activeLessonId: parsed.data.lessonId, updatedAt: FieldValue.serverTimestamp() });
  });
  try {
    await enqueueLesson({ uid, lessonId: parsed.data.lessonId });
  } catch {
    await lessonRef.update({ status: "failed", progress: 0, failureCode: "queue_unavailable", updatedAt: FieldValue.serverTimestamp() });
    await releaseReservation(uid, parsed.data.lessonId, quotaDate);
    throw new HttpsError("unavailable", "Lesson generation is temporarily unavailable.");
  }
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

export const deleteAccount = onCall(callableOptions, async (request) => {
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
