import { httpsCallable } from "@react-native-firebase/functions";
import type { LessonType, UserProfile } from "@resolingo/shared";
import { functions, initializeFirebaseSecurity } from "./firebase";

async function call<Request, Response>(name: string, data: Request): Promise<Response> {
  await initializeFirebaseSecurity();
  const callable = httpsCallable<Request, Response>(functions, name);
  const result = await callable(data);
  return result.data;
}

export const api = {
  initializeProfile: (profile: Omit<UserProfile, "uid" | "onboardingComplete">) => call("initializeProfile", profile),
  createDailyLesson: (type: LessonType, idempotencyKey: string) => call<unknown, { lessonId: string }>("createDailyLesson", { type, idempotencyKey }),
  retryFailedLesson: (lessonId: string) => call("retryFailedLesson", { lessonId }),
  registerPushDevice: (data: { expoPushToken: string; nativePushToken?: string; platform: "ios" | "android" }) => call("registerPushDevice", data),
  updateReminder: (data: { enabled: boolean; time: string; timezone: string }) => call("updateReminder", data),
  setTelemetryConsent: (enabled: boolean) => call("setTelemetryConsent", { enabled }),
  deleteAccount: () => call("deleteAccount", {}),
};
