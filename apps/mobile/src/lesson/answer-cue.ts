/**
 * When the playhead may open the answer microphone again.
 * The iOS checker in LessonVoiceCheckModule uses these same thresholds.
 */

/** Forward slack added to the time a steady playhead could have advanced. */
export const SEEK_SLACK_SECONDS = 0.35;
/** A backward step at least this large is a seek, not clock noise. */
export const SEEK_BACK_SECONDS = 0.2;
/** One tone per cue. A new try has to wait out this gap. */
export const CUE_AGAIN_GAP_SECONDS = 0.9;

export function isPlaybackSeek(input: {
  previousSeconds: number | null;
  seconds: number;
  elapsedSeconds: number;
  rate: number;
}): boolean {
  const { previousSeconds, seconds, elapsedSeconds, rate } = input;
  if (previousSeconds == null || !Number.isFinite(previousSeconds) || !Number.isFinite(seconds)) return false;
  const advance = seconds - previousSeconds;
  if (advance < -SEEK_BACK_SECONDS) return true;
  const allowance = Math.max(0, elapsedSeconds) * Math.max(0, rate) + SEEK_SLACK_SECONDS;
  return advance > allowance;
}

export function mayCueAgain(
  last: { id: string; atSeconds: number } | null,
  id: string,
  nowSeconds: number,
): boolean {
  if (!last || last.id !== id) return true;
  return nowSeconds - last.atSeconds >= CUE_AGAIN_GAP_SECONDS;
}
