import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  CefrLevelSchema,
  LanguageIdSchema,
  LessonTypeSchema,
  type GeneratedLesson,
  type LessonSegment,
} from "@resolingo/shared";
import { logger } from "firebase-functions";
import { mapConcurrent } from "./concurrent.js";
import { DAILY_LIMIT, MAX_TASK_ATTEMPTS, REGION, TTS_SEGMENT_CONCURRENCY } from "./config.js";
import { adminFunctions, db } from "./firebase.js";
import { generateLessonContent } from "./gemini.js";
import { sendUserPush } from "./push.js";
import { withoutReservation } from "./quota.js";
import { synthesizeSegment } from "./tts.js";

type JobPayload = { uid: string; lessonId: string };

export async function enqueueLesson(payload: JobPayload): Promise<void> {
  await adminFunctions
    .taskQueue<JobPayload>(`locations/${REGION}/functions/generateLessonTask`)
    .enqueue(payload);
}

export async function failLessonAndRelease(
  uid: string,
  lessonId: string,
  quotaDate: string,
  failureCode: string,
  options?: { onlyIfStatus?: string; requireEnqueuePending?: boolean },
): Promise<boolean> {
  const lessonRef = db.doc(`users/${uid}/lessons/${lessonId}`);
  const userRef = db.doc(`users/${uid}`);
  const usageRef = quotaDate ? db.doc(`users/${uid}/dailyUsage/${quotaDate}`) : null;
  return db.runTransaction(async (transaction) => {
    const lesson = await transaction.get(lessonRef);
    const user = await transaction.get(userRef);
    const usage = usageRef ? await transaction.get(usageRef) : null;
    const data = lesson.data();
    const status = typeof data?.status === "string" ? data.status : undefined;
    if (!lesson.exists || status === "ready") return false;
    if (options?.onlyIfStatus && status !== options.onlyIfStatus) return false;
    if (options?.requireEnqueuePending && data?.enqueuePending !== true) return false;
    transaction.update(lessonRef, {
      status: "failed",
      progress: 0,
      failureCode,
      enqueuePending: FieldValue.delete(),
      failedAt: Timestamp.now(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (user.exists && user.data()?.activeLessonId === lessonId) {
      transaction.update(userRef, { activeLessonId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    }
    if (usage?.exists) {
      transaction.set(usage.ref, {
        reservations: withoutReservation(usage.data()?.reservations, lessonId),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return true;
  });
}

export function abandonUnenqueuedLesson(uid: string, lessonId: string, quotaDate: string, failureCode: string): Promise<boolean> {
  return failLessonAndRelease(uid, lessonId, quotaDate, failureCode, { onlyIfStatus: "queued", requireEnqueuePending: true });
}

async function recentTopics(uid: string, key: string): Promise<string[]> {
  const snapshot = await db.doc(`users/${uid}/recentTopics/${key}`).get();
  return (snapshot.data()?.topics ?? []).slice(0, 20) as string[];
}

function validateLessonLanguages(
  lesson: GeneratedLesson,
  nativeLanguage: string,
  targetLanguage: string,
): void {
  for (const segment of lesson.segments) {
    if (segment.language !== nativeLanguage && segment.language !== targetLanguage) {
      throw new Error("MODEL_OUTPUT_LANGUAGE_MISMATCH");
    }
  }
}

export async function processLessonJob(payload: JobPayload, retryCount: number): Promise<void> {
  const lessonRef = db.doc(`users/${payload.uid}/lessons/${payload.lessonId}`);
  const userRef = db.doc(`users/${payload.uid}`);
  const claimed = await db.runTransaction(async (transaction) => {
    const [lessonSnapshot, userSnapshot] = await Promise.all([transaction.get(lessonRef), transaction.get(userRef)]);
    if (!lessonSnapshot.exists || !userSnapshot.exists) return null;
    const status = lessonSnapshot.data()?.status;
    if (status === "ready" || status === "failed") return null;
    transaction.update(lessonRef, {
      status: "generating_content",
      progress: 15,
      enqueuePending: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      failureCode: FieldValue.delete(),
    });
    return { lesson: lessonSnapshot.data()!, user: userSnapshot.data()! };
  });
  if (!claimed) return;
  const lessonData = claimed.lesson;
  const user = claimed.user;
  const type = LessonTypeSchema.parse(lessonData.type);
  const nativeLanguage = LanguageIdSchema.parse(user.nativeLanguage);
  const targetLanguage = LanguageIdSchema.parse(user.targetLanguage);
  const level = CefrLevelSchema.parse(user.level);
  const topicKey = `${targetLanguage}-${type}`;

  try {
    const content = await generateLessonContent({
      type,
      nativeLanguage,
      targetLanguage,
      level,
      recentTopics: await recentTopics(payload.uid, topicKey),
    });
    validateLessonLanguages(content, nativeLanguage, targetLanguage);
    await lessonRef.update({
      title: content.title,
      topic: content.topic,
      summary: content.summary,
      segments: content.segments,
      status: "synthesizing_audio",
      progress: 40,
      updatedAt: FieldValue.serverTimestamp(),
    });

    let completedSegments = 0;
    const segments = await mapConcurrent(content.segments as LessonSegment[], TTS_SEGMENT_CONCURRENCY, async (segment) => {
      const synthesized = await synthesizeSegment({ uid: payload.uid, lessonId: payload.lessonId, level, segment });
      completedSegments += 1;
      await lessonRef.update({
        progress: 40 + Math.round((completedSegments / content.segments.length) * 55),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return synthesized;
    });

    const usageRef = db.doc(`users/${payload.uid}/dailyUsage/${lessonData.quotaDate}`);
    const topicRef = db.doc(`users/${payload.uid}/recentTopics/${topicKey}`);
    let published = false;
    await db.runTransaction(async (transaction) => {
      published = false;
      const [currentLesson, usageSnapshot, topicSnapshot] = await Promise.all([
        transaction.get(lessonRef),
        transaction.get(usageRef),
        transaction.get(topicRef),
      ]);
      if (currentLesson.data()?.status === "failed") return;
      published = true;
      const usage = usageSnapshot.data() ?? {};
      const reservations = withoutReservation(usage.reservations, payload.lessonId);
      const readyCount = Math.min(DAILY_LIMIT, Number(usage.readyCount ?? 0) + 1);
      transaction.update(lessonRef, {
        segments,
        status: "ready",
        progress: 100,
        manifest: {
          totalDurationMs: segments.reduce((total, segment) => total + (segment.durationMs ?? 0), 0),
          segmentCount: segments.length,
          completedAt: new Date().toISOString(),
        },
        updatedAt: FieldValue.serverTimestamp(),
        readyAt: FieldValue.serverTimestamp(),
      });
      transaction.set(usageRef, { readyCount, reservations, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.update(userRef, { activeLessonId: FieldValue.delete(), lastLessonDate: lessonData.quotaDate, updatedAt: FieldValue.serverTimestamp() });
      const existingTopics = (topicSnapshot.data()?.topics ?? []) as string[];
      const existingFingerprints = (topicSnapshot.data()?.fingerprints ?? []) as string[];
      transaction.set(topicRef, {
        topics: [content.topic, ...existingTopics.filter((topic) => topic !== content.topic)].slice(0, 20),
        fingerprints: [
          createHash("sha256").update(content.topic.trim().toLowerCase()).digest("hex"),
          ...existingFingerprints,
        ].filter((fingerprint, index, values) => values.indexOf(fingerprint) === index).slice(0, 20),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    if (!published) return;
    await sendUserPush(payload.uid, {
      title: "Your Resolingo lesson is ready",
      body: content.title,
      data: { path: `/lesson/${payload.lessonId}`, lessonId: payload.lessonId },
      channelId: "lessons",
    });
    logger.info("lesson_ready", { lessonId: payload.lessonId, type });
  } catch (error) {
    logger.error("lesson_failed", {
      lessonId: payload.lessonId,
      retryCount,
      failureCode: providerFailureCode(error),
      providerStatus: typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : undefined,
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : undefined,
    });
    if (!isPermanentProviderError(error) && retryCount + 1 < MAX_TASK_ATTEMPTS) {
      await lessonRef.update({ status: "queued", progress: 5, enqueuePending: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      throw error;
    }
    await failLessonAndRelease(payload.uid, payload.lessonId, typeof lessonData.quotaDate === "string" ? lessonData.quotaDate : "", providerFailureCode(error));
  }
}

function isPermanentProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("MODEL_OUTPUT") || message.includes("TTS_VOICE_UNAVAILABLE") || message.includes("TTS_VOICE_TIER_INVALID")) return true;
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  return status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}

function providerFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("TTS_VOICE_TIER_INVALID")) return "voice_tier_invalid";
  if (message.includes("TTS_VOICE_UNAVAILABLE")) return "voice_unavailable";
  if (message.includes("MODEL_OUTPUT_BLOCKED")) return "lesson_blocked";
  if (message.includes("MODEL_OUTPUT")) return "lesson_validation_failed";
  return "provider_failure";
}
