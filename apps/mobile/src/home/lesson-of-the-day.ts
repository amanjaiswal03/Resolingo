import type { DailyPick, Lesson } from "@resolingo/shared";

/** What the lesson-of-the-day card shows right now. */
export type PickCardState =
  | { kind: "planned"; retry: boolean }
  | { kind: "blocked" }
  | { kind: "preparing"; progress: number }
  | { kind: "ready"; lesson: Lesson }
  | { kind: "done"; lesson: Lesson };

const ACTIVE = new Set(["queued", "generating_content", "synthesizing_audio"]);

/**
 * Combines today's pick with the live lesson list. A pick whose lesson is
 * still being written shows its progress, a ready one offers to play, and a
 * failed one can be started again. The daily cap only blocks a pick that has
 * not started yet, and never the welcome lesson, which takes no slot.
 */
export function pickCardState(input: {
  pick: DailyPick;
  lessons: readonly Lesson[];
  capReached: boolean;
}): PickCardState {
  const { pick } = input;
  const lesson = pick.lessonId ? input.lessons.find((item) => item.id === pick.lessonId) : undefined;
  if (pick.lessonId && !lesson) {
    // Just started: the lesson document has not arrived in the list yet.
    return { kind: "preparing", progress: 5 };
  }
  if (lesson && ACTIVE.has(lesson.status)) return { kind: "preparing", progress: Number.isFinite(lesson.progress) ? lesson.progress : 0 };
  if (lesson?.status === "ready") return lesson.completed ? { kind: "done", lesson } : { kind: "ready", lesson };
  const retry = lesson?.status === "failed";
  if (input.capReached && pick.kind !== "welcome") return { kind: "blocked" };
  return { kind: "planned", retry };
}

/** "Mon 24 Nov" for a yyyy-mm-dd day, read as a calendar day with no time zone shift. */
export function pickDateLabel(date: string, locale?: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return "";
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(locale ?? "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(value);
}

/** The welcome lesson never counts toward the three lessons a day. */
export function countsTowardCap(lesson: Pick<Lesson, "plan">): boolean {
  return lesson.plan?.kind !== "welcome";
}

export const typeLabel = { conversation: "Conversation", grammar: "Grammar" } as const;

/** The lesson ids the pick card already covers, so the home screen does not show them twice. */
export function pickLessonId(pick: DailyPick | null | undefined): string | undefined {
  return pick?.lessonId;
}
