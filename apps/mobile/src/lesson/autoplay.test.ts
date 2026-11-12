import { describe, expect, it, vi } from "vitest";
import { armAdvance, playbackPlan, resumeAction } from "./autoplay";

describe("lesson autoplay", () => {
  it("advances to the next segment when the clip finishes", () => {
    expect(playbackPlan({ autoplay: true, index: 0, count: 4, kind: "narration" })).toEqual({
      action: "advance",
      delayMs: 350,
    });
    expect(playbackPlan({ autoplay: true, index: 2, count: 4, kind: "dialogue" }).action).toBe("advance");
  });

  it("holds after a practice turn instead of skipping the learner's response", () => {
    expect(playbackPlan({ autoplay: true, index: 1, count: 4, kind: "drill" })).toEqual({
      action: "hold",
      delayMs: 900,
    });
  });

  it("does not advance while paused, and resume continues", () => {
    expect(playbackPlan({ autoplay: false, index: 1, count: 4, kind: "dialogue" })).toEqual({
      action: "ignore",
      delayMs: 0,
    });
    expect(resumeAction({ clipFinished: false, index: 1, count: 4 })).toBe("play");
    expect(resumeAction({ clipFinished: true, index: 1, count: 4 })).toBe("advance");
    expect(resumeAction({ clipFinished: true, index: 3, count: 4 })).toBe("complete");
  });

  it("completes on the last clip", () => {
    expect(playbackPlan({ autoplay: true, index: 3, count: 4, kind: "recap" }).action).toBe("complete");
  });

  it("cancels a scheduled advance on unmount so it cannot fire after release", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const cancel = armAdvance(350, fire, (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    });
    cancel();
    vi.advanceTimersByTime(1_000);
    expect(fire).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
