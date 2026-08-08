import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { EXPO_ACCESS_TOKEN, OPENAI_API_KEY, REGION, SAFETY_IDENTIFIER_SECRET } from "./config.js";
import { processLessonJob } from "./jobs.js";

export {
  createDailyLesson,
  deleteAccount,
  initializeProfile,
  registerPushDevice,
  retryFailedLesson,
  setTelemetryConsent,
  updateReminder,
} from "./callables.js";
export { cleanupAbandonedJobs, dispatchReminders, processPushReceipts } from "./schedules.js";
export { createUserProfile } from "./accounts.js";

export const generateLessonTask = onTaskDispatched({
  region: REGION,
  secrets: [OPENAI_API_KEY, SAFETY_IDENTIFIER_SECRET, EXPO_ACCESS_TOKEN],
  retryConfig: { maxAttempts: 3, minBackoffSeconds: 10, maxBackoffSeconds: 120 },
  rateLimits: { maxConcurrentDispatches: 8, maxDispatchesPerSecond: 4 },
  memory: "1GiB",
  timeoutSeconds: 540,
}, async (request) => {
  await processLessonJob(request.data as { uid: string; lessonId: string }, request.retryCount ?? 0);
});
