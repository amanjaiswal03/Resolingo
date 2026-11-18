import { describe, expect, it } from "vitest";
import { MAX_PHRASE_AUDIO_SECONDS } from "@resolingo/shared";
import {
  MIN_SPEECH_MS,
  NO_SPEECH_TIMEOUT_MS,
  SILENCE_AFTER_SPEECH_MS,
  SPEECH_DB,
  initialVoiceActivity,
  stepVoiceActivity,
  type VadState,
} from "./voice-activity";

const capMs = MAX_PHRASE_AUDIO_SECONDS * 1000;

function run(levels: { at: number; db: number | null }[], from: VadState = initialVoiceActivity()) {
  let state = from;
  let stop: ReturnType<typeof stepVoiceActivity>["stop"] = null;
  for (const level of levels) {
    const stepped = stepVoiceActivity(state, { durationMs: level.at, meteringDb: level.db, capMs });
    state = stepped.state;
    stop = stepped.stop;
    if (stop) break;
  }
  return { state, stop };
}

describe("voice activity", () => {
  it("stops after speech and a short silence", () => {
    const result = run([
      { at: 200, db: -20 },
      { at: 400, db: -18 },
      { at: 400 + SILENCE_AFTER_SPEECH_MS, db: -55 },
    ]);
    expect(result.stop).toBe("silence");
    expect(result.state.heardSpeech).toBe(true);
    expect(result.state.speechMs).toBeGreaterThanOrEqual(MIN_SPEECH_MS);
  });

  it("keeps listening through a pause that is shorter than the silence window", () => {
    const result = run([
      { at: 300, db: SPEECH_DB },
      { at: 300 + SILENCE_AFTER_SPEECH_MS - 1, db: -50 },
    ]);
    expect(result.stop).toBeNull();
  });

  it("stops when nobody speaks", () => {
    const result = run([
      { at: 1_000, db: -60 },
      { at: NO_SPEECH_TIMEOUT_MS, db: -70 },
    ]);
    expect(result.stop).toBe("no-speech");
    expect(result.state.heardSpeech).toBe(false);
  });

  it("does not treat a missing level as silence", () => {
    const quiet = run([{ at: NO_SPEECH_TIMEOUT_MS, db: null }]);
    expect(quiet.stop).toBeNull();
    expect(quiet.state.sawLevel).toBe(false);
    const capped = run([{ at: capMs, db: null }]);
    expect(capped.stop).toBe("cap");
  });

  it("stops at the hard cap even while the person is still talking", () => {
    const result = run([{ at: capMs, db: -10 }]);
    expect(result.stop).toBe("cap");
    expect(result.state.heardSpeech).toBe(true);
  });
});
