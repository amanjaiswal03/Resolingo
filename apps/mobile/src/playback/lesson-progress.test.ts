import { describe, expect, it } from "vitest";
import {
  capProgress,
  hasResumablePosition,
  mergeProgress,
  parseProgress,
  progressFromDocument,
  progressRatio,
  remainingLabel,
  resumePositionMs,
  shouldSyncToCloud,
} from "./lesson-progress";

const at = (positionMs: number, durationMs = 360_000, updatedAt = 1) => ({ positionMs, durationMs, updatedAt });

describe("lesson progress", () => {
  it("resumes a little before where the learner stopped", () => {
    expect(resumePositionMs(at(120_000), 360_000)).toBe(117_000);
  });

  it("starts from the beginning when barely started, near the end, or never played", () => {
    expect(resumePositionMs(at(4_000), 360_000)).toBeNull();
    expect(resumePositionMs(at(350_000), 360_000)).toBeNull();
    expect(resumePositionMs(undefined, 360_000)).toBeNull();
    expect(resumePositionMs(at(0), 360_000)).toBeNull();
  });

  it("uses the live lesson length over the saved one", () => {
    expect(hasResumablePosition(at(200_000, 600_000), 210_000)).toBe(false);
  });

  it("shows list progress only for a lesson in the middle", () => {
    expect(progressRatio(at(90_000))).toBeCloseTo(0.25);
    expect(progressRatio(at(2_000))).toBeNull();
    expect(progressRatio(at(355_000))).toBeNull();
  });

  it("rounds the time left up to whole minutes", () => {
    expect(remainingLabel(at(90_000))).toBe("5 min left");
    expect(remainingLabel(at(330_000))).toBe("1 min left");
  });

  it("keeps the newer save of each lesson when merging", () => {
    const local = { a: at(10_000, 360_000, 5), b: at(20_000, 360_000, 9) };
    const remote = { a: at(50_000, 360_000, 7), b: at(0, 360_000, 3), c: at(30_000, 360_000, 1) };
    expect(mergeProgress(local, remote)).toEqual({ a: remote.a, b: local.b, c: remote.c });
  });

  it("lets a restart on another device win over an older position", () => {
    expect(mergeProgress({ a: at(120_000, 360_000, 5) }, { a: at(0, 360_000, 6) }).a?.positionMs).toBe(0);
  });

  it("drops malformed stored entries", () => {
    const raw = JSON.stringify({ ok: at(10_000), bad: { positionMs: "x" }, neg: at(-1), nan: { positionMs: 1, durationMs: null, updatedAt: 1 } });
    expect(Object.keys(parseProgress(raw))).toEqual(["ok"]);
    expect(parseProgress("not json")).toEqual({});
    expect(parseProgress("[1,2]")).toEqual({});
    expect(progressFromDocument({ positionMs: 1.4, durationMs: 9.6, updatedAt: 3 })).toEqual({ positionMs: 1, durationMs: 10, updatedAt: 3 });
  });

  it("keeps only the newest entries", () => {
    const map = { a: at(1, 1, 1), b: at(1, 1, 3), c: at(1, 1, 2) };
    expect(Object.keys(capProgress(map, 2)).sort()).toEqual(["b", "c"]);
  });

  it("syncs pauses right away and playing ticks at most every 30 seconds", () => {
    expect(shouldSyncToCloud("pause", 1_000, 1_500)).toBe(true);
    expect(shouldSyncToCloud("tick", undefined, 1_500)).toBe(true);
    expect(shouldSyncToCloud("tick", 1_000, 20_000)).toBe(false);
    expect(shouldSyncToCloud("tick", 1_000, 31_000)).toBe(true);
  });
});
