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
export const DEFAULT_GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
/** Vertex hosts this preview only on the global endpoint, not in europe-west1. */
export const DEFAULT_GEMINI_TTS_LOCATION = "global";
export const GEMINI_TTS_MODEL = defineString("GEMINI_TTS_MODEL", {
  default: DEFAULT_GEMINI_TTS_MODEL,
  description: "Vertex speech model. gemini-3.1-flash-tts-preview is the Gemini 3.1 Flash TTS id.",
});
export const GEMINI_TTS_LOCATION = defineString("GEMINI_TTS_LOCATION", {
  default: DEFAULT_GEMINI_TTS_LOCATION,
  description: "Vertex location for TTS. gemini-3.1-flash-tts-preview is available on global only.",
});
export const TTS_VOICE_TIER = defineString("TTS_VOICE_TIER", {
  default: "wavenet",
  description: "Cloud TTS fallback tier when Gemini TTS fails: wavenet (default), standard, neural2, or chirp3",
});
export const DAILY_LIMIT = 3;
export const MAX_TASK_ATTEMPTS = 3;
export const DELETE_ACCOUNT_TIMEOUT_SECONDS = 540;
