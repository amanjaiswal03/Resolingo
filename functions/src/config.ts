import { defineSecret, defineString } from "firebase-functions/params";

export const REGION = "europe-west1";
export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
export const SAFETY_IDENTIFIER_SECRET = defineSecret("SAFETY_IDENTIFIER_SECRET");
export const EXPO_ACCESS_TOKEN = defineSecret("EXPO_ACCESS_TOKEN");
export const OPENAI_LESSON_MODEL = defineString("OPENAI_LESSON_MODEL", {
  default: "gpt-5.6-luna",
  description: "OpenAI model used for structured lesson generation",
});
export const DAILY_LIMIT = 3;
export const MAX_TASK_ATTEMPTS = 3;
