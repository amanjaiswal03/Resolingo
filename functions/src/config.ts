import { defineSecret, defineString } from "firebase-functions/params";

export const REGION = "europe-west1";
export const EXPO_ACCESS_TOKEN = defineSecret("EXPO_ACCESS_TOKEN");
export const DEFAULT_GEMINI_LESSON_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_LOCATION = "eu";
export const GEMINI_LESSON_MODEL = defineString("GEMINI_LESSON_MODEL", {
  default: DEFAULT_GEMINI_LESSON_MODEL,
  description: "Vertex AI Gemini model used for structured lesson generation",
});
export const GEMINI_LOCATION = defineString("GEMINI_LOCATION", {
  default: DEFAULT_GEMINI_LOCATION,
  description: "Vertex AI location. gemini-3.5-flash-lite is not in europe-west1; eu keeps processing in the EU.",
});
export const TTS_VOICE_TIER = defineString("TTS_VOICE_TIER", {
  default: "wavenet",
  description: "Google TTS tier: wavenet (default), standard, neural2, or chirp3",
});
export const DAILY_LIMIT = 3;
export const MAX_TASK_ATTEMPTS = 3;
export const DELETE_ACCOUNT_TIMEOUT_SECONDS = 540;
