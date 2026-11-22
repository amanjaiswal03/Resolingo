export type SpokenOutcome = "recalled" | "compare" | "unclear" | "skipped";

/**
 * After a spoken result, or a pause with no voice, skip the rest of the baked pause.
 * A window still in progress keeps the current position.
 */
export function resumeAfterFeedback(input: {
  outcome: SpokenOutcome | null;
  currentSeconds: number;
  pauseEndSeconds: number;
}): number {
  if (input.outcome == null) return input.currentSeconds;
  if (!Number.isFinite(input.currentSeconds)) return input.currentSeconds;
  if (!Number.isFinite(input.pauseEndSeconds)) return input.currentSeconds;
  return Math.max(input.currentSeconds, input.pauseEndSeconds);
}
