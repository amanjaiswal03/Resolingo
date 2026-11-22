import { describe, expect, it } from "vitest";
import { CUE_AGAIN_GAP_SECONDS, isPlaybackSeek, mayCueAgain } from "./answer-cue";

describe("answer cue restarts", () => {
  it("does not treat a rate change, a pause, or a coarse slow clock as a new try", () => {
    expect(isPlaybackSeek({ previousSeconds: 12, seconds: 12, elapsedSeconds: 0.05, rate: 0.12 })).toBe(false);
    expect(isPlaybackSeek({ previousSeconds: 12, seconds: 12.02, elapsedSeconds: 0, rate: 0 })).toBe(false);
    expect(isPlaybackSeek({ previousSeconds: 12, seconds: 11.9, elapsedSeconds: 0.05, rate: 0.12 })).toBe(false);
    expect(isPlaybackSeek({ previousSeconds: 12, seconds: 12.2, elapsedSeconds: 0.05, rate: 0.12 })).toBe(false);
    expect(isPlaybackSeek({ previousSeconds: null, seconds: 4, elapsedSeconds: 0.05, rate: 1 })).toBe(false);
  });

  it("treats a real skip as a seek so the pause can open once", () => {
    expect(isPlaybackSeek({ previousSeconds: 4, seconds: 12.5, elapsedSeconds: 0.05, rate: 1 })).toBe(true);
    expect(isPlaybackSeek({ previousSeconds: 12, seconds: 3, elapsedSeconds: 0.05, rate: 1 })).toBe(true);
  });

  it("allows one tone per try and a later retry of the same cue", () => {
    expect(mayCueAgain(null, "cue", 10)).toBe(true);
    expect(mayCueAgain({ id: "cue", atSeconds: 10 }, "cue", 10.2)).toBe(false);
    expect(mayCueAgain({ id: "cue", atSeconds: 10 }, "other", 10.2)).toBe(true);
    expect(mayCueAgain({ id: "cue", atSeconds: 10 }, "cue", 10 + CUE_AGAIN_GAP_SECONDS)).toBe(true);
  });
});
