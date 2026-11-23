/** dBFS from expo-audio. Speech near the phone is usually above this; a quiet room is not. */
export const SPEECH_DB = -40;

/** Pause after speech before the recording stops itself. */
export const SILENCE_AFTER_SPEECH_MS = 1_300;

/** Give up when the microphone never hears speech. */
export const NO_SPEECH_TIMEOUT_MS = 5_000;

/** Ignore a single click. A short word still clears this on the next level sample. */
export const MIN_SPEECH_MS = 200;

/**
 * A working microphone in a quiet room still reads around -50 to -70 dBFS.
 * Readings at the floor mean the meter is not reporting (the input was not
 * ready, or the session was switched), so they must not count as silence.
 */
export const DEAD_METER_DB = -100;

/** A metering sample the voice detector can trust, or null when the meter is not reporting. */
export function usableLevel(db: unknown): number | null {
  return typeof db === "number" && Number.isFinite(db) && db > DEAD_METER_DB ? db : null;
}

export type VadState = {
  elapsedMs: number;
  speechMs: number;
  silenceMs: number;
  heardSpeech: boolean;
  sawLevel: boolean;
};

export type VadStop = "silence" | "no-speech" | "cap";

export function initialVoiceActivity(): VadState {
  return { elapsedMs: 0, speechMs: 0, silenceMs: 0, heardSpeech: false, sawLevel: false };
}

/**
 * Advance the detector by one metering sample.
 * A missing level does not count as silence, so a recorder that never reports
 * metering still waits for the hard cap or the stop button.
 */
export function stepVoiceActivity(
  state: VadState,
  sample: { durationMs: number; meteringDb: number | null; capMs: number },
): { state: VadState; stop: VadStop | null } {
  const durationMs = Number.isFinite(sample.durationMs) ? Math.max(state.elapsedMs, sample.durationMs) : state.elapsedMs;
  const dtMs = durationMs - state.elapsedMs;
  let { speechMs, silenceMs, heardSpeech, sawLevel } = state;
  const level = sample.meteringDb;
  if (level != null && Number.isFinite(level)) {
    sawLevel = true;
    if (level >= SPEECH_DB) {
      heardSpeech = true;
      speechMs += dtMs;
      silenceMs = 0;
    } else if (heardSpeech) {
      silenceMs += dtMs;
    }
  }
  const next: VadState = { elapsedMs: durationMs, speechMs, silenceMs, heardSpeech, sawLevel };
  if (durationMs >= sample.capMs) return { state: next, stop: "cap" };
  if (sawLevel && heardSpeech && speechMs >= MIN_SPEECH_MS && silenceMs >= SILENCE_AFTER_SPEECH_MS) {
    return { state: next, stop: "silence" };
  }
  if (sawLevel && !heardSpeech && durationMs >= NO_SPEECH_TIMEOUT_MS) {
    return { state: next, stop: "no-speech" };
  }
  return { state: next, stop: null };
}
