/** Used when a phrase has no measured duration yet, so the bar still has a place for it. */
const FALLBACK_DURATION_MS = 1_000;

export type LessonTimeline = {
  startsMs: number[];
  durationsMs: number[];
  totalMs: number;
};

export function lessonTimeline(clips: { durationMs?: number }[]): LessonTimeline {
  const durationsMs = clips.map((clip) => (clip.durationMs && clip.durationMs > 0 ? clip.durationMs : FALLBACK_DURATION_MS));
  const startsMs: number[] = [];
  let totalMs = 0;
  for (const duration of durationsMs) {
    startsMs.push(totalMs);
    totalMs += duration;
  }
  return { startsMs, durationsMs, totalMs };
}

/** Position on the combined lesson, from the phrase that is playing and how far into it we are. */
export function elapsedMs(timeline: LessonTimeline, index: number, currentTimeSec: number): number {
  if (timeline.startsMs.length === 0) return 0;
  const safeIndex = Math.min(Math.max(index, 0), timeline.startsMs.length - 1);
  return (timeline.startsMs[safeIndex] ?? 0) + Math.max(0, currentTimeSec) * 1_000;
}

/** `m:ss` for the transport clock. Lessons are a few minutes, so hours are not needed. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1_000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Map a position on the combined lesson back to a phrase and a time within that phrase. */
export function seekInTimeline(timeline: LessonTimeline, targetMs: number): { index: number; offsetSec: number } {
  if (timeline.startsMs.length === 0) return { index: 0, offsetSec: 0 };
  const clamped = Math.min(Math.max(0, targetMs), timeline.totalMs);
  let index = 0;
  for (let i = 0; i < timeline.startsMs.length; i += 1) {
    if ((timeline.startsMs[i] ?? 0) <= clamped) index = i;
  }
  const offsetMs = Math.min(clamped - (timeline.startsMs[index] ?? 0), timeline.durationsMs[index] ?? 0);
  return { index, offsetSec: offsetMs / 1_000 };
}
