import { describe, expect, it } from "vitest";
import { shouldFinishEarly } from "./answer-endpoint";

const listening = {
  score: 0.2,
  stableSeconds: 0,
  quietSeconds: 0,
  audibleSeconds: 0.5,
  elapsedSeconds: 1,
  dictation: false,
};

describe("early end of a spoken answer", () => {
  it("moves on once a good partial has settled and the mic is quiet", () => {
    expect(shouldFinishEarly({ ...listening, score: 0.8, stableSeconds: 0.45, quietSeconds: 0.75 })).toBe("heard");
    expect(shouldFinishEarly({ ...listening, score: 0.8, stableSeconds: 0.2, quietSeconds: 0.75 })).toBeNull();
    expect(shouldFinishEarly({ ...listening, score: 0.8, stableSeconds: 0.45, quietSeconds: 0.3 })).toBeNull();
    expect(shouldFinishEarly({ ...listening, score: 0.6, stableSeconds: 0.45, quietSeconds: 0.75 })).toBeNull();
  });

  it("leaves a pause that never hears a voice, and dictation keeps the timer", () => {
    expect(shouldFinishEarly({ ...listening, audibleSeconds: 0, elapsedSeconds: 2.6, score: 0 })).toBe("silence");
    expect(shouldFinishEarly({ ...listening, audibleSeconds: 0, elapsedSeconds: 1, score: 0 })).toBeNull();
    expect(shouldFinishEarly({
      ...listening, score: 0.9, stableSeconds: 0.5, quietSeconds: 0.8, dictation: true,
    })).toBeNull();
    expect(shouldFinishEarly({
      ...listening, audibleSeconds: 0, elapsedSeconds: 4, dictation: true,
    })).toBeNull();
  });
});