/** Silence between clips so play-through does not feel cut off. */
export const BETWEEN_SEGMENT_GAP_MS = 350;
/** Beat of silence after a practice prompt before the player waits for the learner. */
export const RESPONSE_GAP_MS = 900;

/** Listen-and-repeat drills are the turns that need the learner to respond. */
export function segmentNeedsResponse(kind: string): boolean {
  return kind === "drill";
}

export function playbackPlan(input: {
  autoplay: boolean;
  index: number;
  count: number;
  kind: string;
}): { action: "ignore" | "complete" | "advance" | "hold"; delayMs: number } {
  if (!input.autoplay) return { action: "ignore", delayMs: 0 };
  if (segmentNeedsResponse(input.kind)) return { action: "hold", delayMs: RESPONSE_GAP_MS };
  if (input.count <= 0 || input.index >= input.count - 1) return { action: "complete", delayMs: 0 };
  return { action: "advance", delayMs: BETWEEN_SEGMENT_GAP_MS };
}

/** Pause leaves a finished clip where it is. Play continues that clip, or the lesson after it. */
export function resumeAction(input: {
  clipFinished: boolean;
  index: number;
  count: number;
}): "play" | "advance" | "complete" {
  if (!input.clipFinished) return "play";
  if (input.index >= input.count - 1) return "complete";
  return "advance";
}

/**
 * Schedule the next turn. Cancel drops both the timer and a callback that
 * already started, so unmount cannot advance playback after release.
 */
export function armAdvance(
  delayMs: number,
  fire: () => void,
  setTimer: (fn: () => void, ms: number) => () => void,
): () => void {
  let live = true;
  const cancelTimer = setTimer(() => {
    if (live) fire();
  }, delayMs);
  return () => {
    live = false;
    cancelTimer();
  };
}
