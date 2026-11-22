import { describe, expect, it } from "vitest";
import { clearAttemptsFrom, cuesRewoundTo, reduceAnswerAttempts, type AnswerAttempts } from "./answer-attempts";

const empty: AnswerAttempts = { attempts: {}, results: {} };

describe("answer attempt checks", () => {
  it("keeps only the latest capture and ignores a late transcript from the previous try", () => {
    const first = reduceAnswerAttempts(empty, { type: "recording", id: "cue", captureId: "a" });
    const heard = reduceAnswerAttempts(first, {
      type: "answer", id: "cue", captureId: "a", result: { verdict: "compare", heard: "danke" },
    });
    const retry = reduceAnswerAttempts(heard, { type: "recording", id: "cue", captureId: "b" });
    expect(retry.results.cue).toBeUndefined();
    const stale = reduceAnswerAttempts(retry, {
      type: "answer", id: "cue", captureId: "a", result: { verdict: "compare", heard: "danke" },
    });
    expect(stale.results.cue).toBeUndefined();
    const latest = reduceAnswerAttempts(stale, {
      type: "answer", id: "cue", captureId: "b", result: { verdict: "recalled", heard: "bitte" },
    });
    expect(latest.results.cue).toEqual({ verdict: "recalled", heard: "bitte" });
  });

  it("clears the cue when the learner goes back, so the old attempt cannot resolve later", () => {
    const checked = reduceAnswerAttempts(
      reduceAnswerAttempts(empty, { type: "recording", id: "cue", captureId: "a" }),
      { type: "answer", id: "cue", captureId: "a", result: { verdict: "recalled", heard: "danke" } },
    );
    const backedUp = clearAttemptsFrom(checked, ["cue"]);
    expect(backedUp.results).toEqual({});
    const late = reduceAnswerAttempts(backedUp, {
      type: "status", id: "cue", captureId: "a", result: { verdict: "checking" },
    });
    expect(late.results).toEqual({});
  });

  it("rewinds every cue that the seek will play again", () => {
    const windows = [
      { id: "early", endSeconds: 12 },
      { id: "pause", endSeconds: 28 },
      { id: "later", endSeconds: 46 },
    ];
    expect(cuesRewoundTo(windows, 20)).toEqual(["pause", "later"]);
    expect(cuesRewoundTo(windows, 40)).toEqual(["later"]);
  });
});
