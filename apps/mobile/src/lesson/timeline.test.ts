import { describe, expect, it } from "vitest";
import { elapsedMs, formatClock, lessonTimeline, playbackClips, seekInTimeline, segmentAtClipTime } from "./timeline";

describe("lesson timeline", () => {
  const timeline = lessonTimeline([
    { durationMs: 1_000 },
    { durationMs: 2_500 },
    { durationMs: 500 },
  ]);

  it("lays every phrase onto one timeline", () => {
    expect(timeline.startsMs).toEqual([0, 1_000, 3_500]);
    expect(timeline.totalMs).toBe(4_000);
  });

  it("keeps a place for a phrase that has no duration yet", () => {
    expect(lessonTimeline([{ durationMs: 1_000 }, {}]).totalMs).toBe(2_000);
  });

  it("seeks across phrase boundaries", () => {
    expect(seekInTimeline(timeline, 1_500)).toEqual({ index: 1, offsetSec: 0.5 });
    expect(seekInTimeline(timeline, -100)).toEqual({ index: 0, offsetSec: 0 });
    expect(seekInTimeline(timeline, 3_700)).toEqual({ index: 2, offsetSec: 0.2 });
    expect(seekInTimeline(timeline, 9_000)).toEqual({ index: 2, offsetSec: 0.5 });
  });

  it("formats the transport clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(1_250)).toBe("0:01");
    expect(formatClock(75_000)).toBe("1:15");
  });

  it("plays a dialogue scene once when its lines share one audio file", () => {
    const clips = playbackClips([
      { id: "seg_01", kind: "narration", speaker: "teacher", delivery: "warm", language: "en-US", text: "Welcome.", audioPath: "welcome.wav", audioUrl: "https://example.com/welcome.wav", durationMs: 1_000 },
      { id: "seg_02", kind: "dialogue", speaker: "speakerA", delivery: "warm", language: "de-DE", text: "Hallo.", audioPath: "scene.wav", audioUrl: "https://example.com/scene.wav", durationMs: 3_000 },
      { id: "seg_03", kind: "dialogue", speaker: "speakerB", delivery: "warm", language: "de-DE", text: "Hi.", audioPath: "scene.wav", audioUrl: "https://example.com/scene.wav" },
    ]);
    expect(clips.map((clip) => clip.id)).toEqual(["seg_01", "seg_02"]);
    expect(clips[1]?.segmentIds).toEqual(["seg_02", "seg_03"]);
    expect(lessonTimeline(clips).totalMs).toBe(4_000);
    const scene = clips[1]!;
    expect(segmentAtClipTime(scene, 0, 3_000)).toBe("seg_02");
    expect(segmentAtClipTime(scene, 2_900, 3_000)).toBe("seg_03");
  });

  it("counts time from the start of the lesson, not the start of the phrase", () => {
    expect(elapsedMs(timeline, 1, 0.25)).toBe(1_250);
    expect(elapsedMs(lessonTimeline([]), 0, 4)).toBe(0);
  });
});
