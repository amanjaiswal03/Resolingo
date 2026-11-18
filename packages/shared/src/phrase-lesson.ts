import type { LessonStatus } from "./schemas.js";

export type PhraseLessonControl = "create" | "play" | "generating" | "retry";

/** What the phrase screen should offer for the lesson linked from the phrase. */
export function phraseLessonControl(status: LessonStatus | null): PhraseLessonControl {
  if (status == null) return "create";
  if (status === "ready") return "play";
  if (status === "failed") return "retry";
  return "generating";
}

/**
 * A phrase lesson that still exists should be reused. A missing document means
 * the lesson was deleted, so a new one is allowed.
 */
export function reusablePhraseLesson(linked: { id: string; exists: boolean } | null): string | null {
  if (!linked?.exists || !linked.id) return null;
  return linked.id;
}
