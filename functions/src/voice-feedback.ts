import { LanguageIdSchema, line, type LanguageId } from "@resolingo/shared";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { requireUid } from "./auth.js";
import { REGION } from "./config.js";
import { db } from "./firebase.js";
import { answerFeedbackLines } from "./answer-feedback-lines.js";
import { synthesizeTeacherFeedback } from "./tts.js";

// A spoken answer is never sent out for feedback. A match is two short calm
// lines from the teaching table. A miss is a short close or unclear line.

const inFlight = new Map<LanguageId, Promise<{ recalled: string[]; compare: string[]; unclear: string[] }>>();

export const lessonVoiceFeedback = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  const uid = requireUid(request);
  const id = request.data?.lessonId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new HttpsError("invalid-argument", "Choose a lesson.");
  }
  const lesson = (await db.doc(`users/${uid}/lessons/${id}`).get()).data();
  if (lesson?.status !== "ready") throw new HttpsError("not-found", "Lesson is not available.");
  const segments: unknown[] = Array.isArray(lesson.segments) ? lesson.segments : [];
  const intro = segments.find((part): part is { language: unknown } =>
    !!part && typeof part === "object" && "phase" in part && part.phase === "intro" && "language" in part,
  );
  const language = LanguageIdSchema.safeParse(intro?.language);
  if (!language.success) throw new HttpsError("failed-precondition", "The narrator language is unavailable.");
  const existing = inFlight.get(language.data);
  if (existing) return existing;
  const miss = answerFeedbackLines[language.data];
  const speak = (text: string, delivery: "praise" | "gentle") => synthesizeTeacherFeedback(language.data, text, delivery);
  const task = Promise.all([
    speak(line(language.data, "matchYes"), "praise"),
    speak(line(language.data, "matchGood"), "praise"),
    speak(miss.close[0], "gentle"),
    speak(miss.close[1], "gentle"),
    speak(miss.unclear, "gentle"),
  ])
    .then(([first, second, close, nearly, unclear]) => ({
      recalled: [first, second], compare: [close, nearly], unclear: [unclear],
    }))
    .finally(() => inFlight.delete(language.data));
  inFlight.set(language.data, task);
  return task;
});
