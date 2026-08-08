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
import { DAILY_LIMIT, MAX_TASK_ATTEMPTS, REGION } from "./config.js";
import { adminFunctions, db } from "./firebase.js";
import { generateLessonContent } from "./openai.js";
import { sendUserPush } from "./push.js";
import { synthesizeSegment } from "./tts.js";

type JobPayload = { uid: string; lessonId: string };

export async function enqueueLesson(payload: JobPayload): Promise<void> {
  await adminFunctions
    .taskQueue<JobPayload>(`locations/${REGION}/functions/generateLessonTask`)
    .enqueue(payload);
}

export async function releaseReservation(uid: string, lessonId: string, quotaDate: string): Promise<void> {
  const userRef = db.doc(`users/${uid}`);
  const usageRef = db.doc(`users/${uid}/dailyUsage/${quotaDate}`);
  await db.runTransaction(async (transaction) => {
    const user = await transaction.get(userRef);
    const usage = await transaction.get(usageRef);
    if (user.data()?.activeLessonId === lessonId) {
      transaction.update(userRef, { activeLessonId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    }
    if (usage.exists) {
      const reservations = ((usage.data()?.reservations ?? []) as string[]).filter((id) => id !== lessonId);
      transaction.set(usageRef, { reservations, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
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

async function mapConcurrent<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]!, index);
    }
  }));
  return results;
}

export async function processLessonJob(payload: JobPayload, retryCount: number): Promise<void> {
  const lessonRef = db.doc(`users/${payload.uid}/lessons/${payload.lessonId}`);
  const userRef = db.doc(`users/${payload.uid}`);
  const [lessonSnapshot, userSnapshot] = await Promise.all([lessonRef.get(), userRef.get()]);
  if (!lessonSnapshot.exists || !userSnapshot.exists) return;
  const lessonData = lessonSnapshot.data()!;
  if (lessonData.status === "ready") return;
  const user = userSnapshot.data()!;
  const type = LessonTypeSchema.parse(lessonData.type);
  const nativeLanguage = LanguageIdSchema.parse(user.nativeLanguage);
  const targetLanguage = LanguageIdSchema.parse(user.targetLanguage);
  const level = CefrLevelSchema.parse(user.level);
  const topicKey = `${targetLanguage}-${type}`;

  try {
    await lessonRef.update({ status: "generating_content", progress: 15, updatedAt: FieldValue.serverTimestamp(), failureCode: FieldValue.delete() });
    const content = await generateLessonContent({
      uid: payload.uid,
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
    const segments = await mapConcurrent(content.segments as LessonSegment[], 4, async (segment) => {
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
    await db.runTransaction(async (transaction) => {
      const [usageSnapshot, topicSnapshot] = await Promise.all([
        transaction.get(usageRef),
        transaction.get(topicRef),
      ]);
      const usage = usageSnapshot.data() ?? {};
      const reservations = ((usage.reservations ?? []) as string[]).filter((id) => id !== payload.lessonId);
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
    });
    if (!isPermanentProviderError(error) && retryCount + 1 < MAX_TASK_ATTEMPTS) {
      await lessonRef.update({ status: "queued", progress: 5, updatedAt: FieldValue.serverTimestamp() });
      throw error;
    }
    await lessonRef.update({
      status: "failed",
      failureCode: providerFailureCode(error),
      progress: 0,
      updatedAt: FieldValue.serverTimestamp(),
      failedAt: Timestamp.now(),
    });
    await releaseReservation(payload.uid, payload.lessonId, lessonData.quotaDate as string);
  }
}

function isPermanentProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("MODEL_OUTPUT") || message.includes("TTS_VOICE_UNAVAILABLE")) return true;
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  return status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}

function providerFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("TTS_VOICE_UNAVAILABLE")) return "voice_unavailable";
  if (message.includes("MODEL_OUTPUT")) return "lesson_validation_failed";
  return "provider_failure";
}
