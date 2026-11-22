import type { VoiceResult } from "./phrase-match";

export type AnswerAttempts = {
  /** The capture that may still update a cue. A missing id means the cue was reset. */
  attempts: Record<string, string>;
  results: Record<string, VoiceResult>;
};

export type AnswerAttemptEvent =
  | { type: "recording"; id: string; captureId: string }
  | { type: "cancelled"; id: string }
  | { type: "status"; id: string; captureId: string; result: VoiceResult }
  | { type: "answer"; id: string; captureId: string; result: VoiceResult };

/** Cues whose model has not finished by the seek target will be heard again. */
export function cuesRewoundTo(windows: readonly { id: string; endSeconds: number }[], seconds: number): string[] {
  return windows.filter((window) => window.endSeconds >= seconds - 0.3).map((window) => window.id);
}

/** Drop a stored result when the learner backs up into that cue. */
export function clearAttemptsFrom(state: AnswerAttempts, ids: readonly string[]): AnswerAttempts {
  if (ids.length === 0) return state;
  const dropping = new Set(ids);
  const attempts = { ...state.attempts };
  const results = { ...state.results };
  for (const id of dropping) {
    delete attempts[id];
    delete results[id];
  }
  return { attempts, results };
}

/**
 * A cue is checked against one capture. Going back or starting another try
 * retires the previous capture, and a late transcript from it is ignored.
 */
export function reduceAnswerAttempts(state: AnswerAttempts, event: AnswerAttemptEvent): AnswerAttempts {
  if (event.type === "cancelled") return clearAttemptsFrom(state, [event.id]);
  if (event.type === "recording") {
    const results = { ...state.results };
    delete results[event.id];
    return { attempts: { ...state.attempts, [event.id]: event.captureId }, results };
  }
  if (!event.captureId || state.attempts[event.id] !== event.captureId) return state;
  return { ...state, results: { ...state.results, [event.id]: event.result } };
}
