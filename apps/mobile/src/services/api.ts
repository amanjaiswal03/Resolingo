import { httpsCallable } from "@react-native-firebase/functions";
import type { LessonType, UserProfile } from "@resolingo/shared";
import { functions, initializeFirebaseSecurity } from "./firebase";

async function call<Request, Response>(name: string, data: Request): Promise<Response> {
  await initializeFirebaseSecurity();
  const callable = httpsCallable<Request, Response>(functions, name);
  const result = await callable(data);
  return result.data;
}

type DailyLessonType = Exclude<LessonType, "phrase">;
export type LessonVoiceClips = { recalled: string[]; compare: string[]; unclear: string[] };

export const api = {
  initializeProfile: (profile: Omit<UserProfile, "uid" | "onboardingComplete" | "unlimitedLessons">) => call("initializeProfile", profile),
  createDailyLesson: (type: DailyLessonType, idempotencyKey: string) => call<unknown, { lessonId: string }>("createDailyLesson", { type, idempotencyKey }),
  lessonVoiceFeedback: (lessonId: string) => call<{ lessonId: string }, LessonVoiceClips>("lessonVoiceFeedback", { lessonId }),
  translatePhrase: (text: string) => call<unknown, {
    phraseId: string;
    nativeText: string;
    translation: string;
    transliteration?: string;
    alternatives: { label: string; text: string; transliteration?: string }[];
    inputLanguage: "native" | "target" | "mixed" | "unknown";
    note?: string;
    audioPath?: string;
    lessonId?: string;
  }>("translatePhrase", { mode: "translate", text }),
  transcribePhrase: (audio: { audioBase64: string; mimeType: "audio/m4a" | "audio/mp4" | "audio/aac" | "audio/wav"; durationMs: number }) => call<unknown, {
    mode: "transcribe";
    nativeText: string;
  }>("translatePhrase", { mode: "transcribe", ...audio }),
  /** Transcribes a spoken answer in the learner's target language for a Skills review. */
  checkSpokenPhrase: (audio: { audioBase64: string; mimeType: "audio/m4a" | "audio/mp4" | "audio/aac" | "audio/wav"; durationMs: number }) => call<unknown, {
    mode: "practice";
    heard: string;
  }>("translatePhrase", { mode: "practice", ...audio }),
  createPhraseLesson: (phraseId: string, idempotencyKey: string) => call<unknown, { lessonId: string }>("createPhraseLesson", { phraseId, idempotencyKey }),
  retryFailedLesson: (lessonId: string) => call("retryFailedLesson", { lessonId }),
  deleteLesson: (lessonId: string) => call("deleteLesson", { lessonId }),
  registerPushDevice: (data: { expoPushToken: string; nativePushToken?: string; platform: "ios" | "android" }) => call("registerPushDevice", data),
  updateReminder: (data: { enabled: boolean; time: string; timezone: string }) => call("updateReminder", data),
  setTelemetryConsent: (enabled: boolean) => call("setTelemetryConsent", { enabled }),
  deleteAccount: () => call("deleteAccount", {}),
};
