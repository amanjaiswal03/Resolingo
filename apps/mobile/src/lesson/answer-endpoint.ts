import { MATCH_SCORE } from "./phrase-match";

/** The partial has to sit still, then the mic has to go quiet, before we move on. */
export const EARLY_STABLE_SECONDS = 0.4;
export const EARLY_QUIET_SECONDS = 0.7;
/** No speech at all: leave the pause instead of waiting it out. */
export const EARLY_SILENCE_SECONDS = 2.5;
export const EARLY_MIN_VOICE_SECONDS = 0.045;

export function shouldFinishEarly(input: {
  score: number;
  stableSeconds: number;
  quietSeconds: number;
  audibleSeconds: number;
  elapsedSeconds: number;
  /** Dictation transcribes after the mic closes, so it keeps the normal pause. */
  dictation: boolean;
}): "heard" | "silence" | null {
  if (input.dictation) return null;
  if (input.audibleSeconds < EARLY_MIN_VOICE_SECONDS && input.elapsedSeconds >= EARLY_SILENCE_SECONDS) return "silence";
  if (input.score >= MATCH_SCORE && input.stableSeconds >= EARLY_STABLE_SECONDS && input.quietSeconds >= EARLY_QUIET_SECONDS) return "heard";
  return null;
}
