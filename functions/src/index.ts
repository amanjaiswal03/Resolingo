import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { EXPO_ACCESS_TOKEN, REGION } from "./config.js";
import { processLessonJob } from "./jobs.js";
import { recordLessonReviews } from "./reviews.js";

export {
  createDailyLesson,
  createPhraseLesson,
  deleteAccount,
  initializeProfile,
  registerPushDevice,
  retryFailedLesson,
  setTelemetryConsent,
  translatePhrase,
  updateReminder,
} from "./callables.js";
export { cleanupAbandonedJobs, dispatchReminders, processPushReceipts, recoverUnenqueuedLessons } from "./schedules.js";
export { createUserProfile } from "./accounts.js";

export const generateLessonTask = onTaskDispatched({
  region: REGION,
  secrets: [EXPO_ACCESS_TOKEN],
  retryConfig: { maxAttempts: 3, minBackoffSeconds: 10, maxBackoffSeconds: 120 },
  rateLimits: { maxConcurrentDispatches: 8, maxDispatchesPerSecond: 4 },
  memory: "1GiB",
  timeoutSeconds: 900,
}, async (request) => {
  await processLessonJob(request.data as { uid: string; lessonId: string }, request.retryCount ?? 0);
});

/** When the learner finishes a lesson, remember the phrases they produced. */
export const recordLessonReviewItems = onDocumentUpdated({
  document: "users/{uid}/lessons/{lessonId}",
  region: REGION,
}, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (before?.completed === true || after?.completed !== true || after.reviewsRecorded === true) return;
  const uid = event.params.uid;
  const lessonId = event.params.lessonId;
  if (!uid || !lessonId) return;
  await recordLessonReviews(uid, lessonId);
});
