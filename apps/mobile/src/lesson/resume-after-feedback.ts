export type SpokenOutcome = "recalled" | "compare" | "unclear" | "skipped";

/**
 * After a spoken result, skip the rest of the baked pause.
 * Still speaking, or no answer at all, keeps the current position.
 */
export function resumeAfterFeedback(input: {
  outcome: SpokenOutcome | null;
  currentSeconds: number;
  pauseEndSeconds: number;
}): number {
  if (input.outcome == null || input.outcome === "skipped") return input.currentSeconds;
  if (!Number.isFinite(input.currentSeconds)) return input.currentSeconds;
  if (!Number.isFinite(input.pauseEndSeconds)) return input.currentSeconds;
  return Math.max(input.currentSeconds, input.pauseEndSeconds);
}
