import type { LessonSegment } from "@resolingo/shared";
import { describe, expect, it } from "vitest";
import { answerPlan } from "./answer-windows";
import { playbackClips } from "./timeline";

const intro: LessonSegment = {
  id: "intro", kind: "narration", speaker: "teacher", delivery: "warm", language: "en-US",
  text: "Let's start.", audioUrl: "https://example.com/intro.wav",
};
const prompt: LessonSegment = {
  ...intro, id: "prompt", kind: "drill", phase: "recall", text: "Say: the bill, please.",
  pauseAfterMs: 5_000, audioUrl: "https://example.com/prompt.wav",
};
const example: LessonSegment = {
  ...intro, id: "example", kind: "drill", phase: "answer", speaker: "speakerA", language: "de-DE",
  text: "Die Rechnung, bitte.", translation: "The bill, please.", audioUrl: "https://example.com/example.wav",
};

describe("spoken answer windows", () => {
  it("leaves room for feedback before the model, even when the model ends the lesson", () => {
    const segments = [intro, prompt, example];
    expect(answerPlan(segments, playbackClips(segments), [1_000, 7_000, 2_000])).toEqual({
      language: "de-DE",
      windows: [{
        id: "prompt", expected: "Die Rechnung, bitte.", startSeconds: 3.06, endSeconds: 7.78, feedbackAtSeconds: 7.9,
        answerId: "example", translation: "The bill, please.", modelAudioUrl: example.audioUrl,
      }],
    });
  });

  it("does not open the mic for a reflection pause or across a missing segment", () => {
    const reflection: LessonSegment = { ...prompt, phase: "notice" };
    expect(answerPlan([reflection, example], playbackClips([reflection, example]), [7_000, 2_000])).toBeNull();
    const silentTransition: LessonSegment = { id: "transition", kind: "narration", speaker: "teacher", delivery: "warm", text: "Listen.", language: "en-US" };
    const segments = [prompt, silentTransition, example];
    expect(answerPlan(segments, playbackClips(segments), [7_000, 2_000])).toBeNull();
  });

  it("passes over a listening pause and still opens the next speaking window", () => {
    const listening: LessonSegment = { ...intro, kind: "explanation", text: "Let's hear what that means.", pauseAfterMs: 650 };
    const segments = [listening, prompt, example];
    expect(answerPlan(segments, playbackClips(segments), [1_900, 7_000, 2_000])?.windows.map(({ id, startSeconds }) => (
      { id, startSeconds }
    ))).toEqual([{ id: prompt.id, startSeconds: 3.96 }]);
  });

  it("includes repeated phrases, short buildup prompts, and later lesson drills", () => {
    const phases = ["buildup", "recall", "review", "recombine", "warmup", "roleplay", "quick"];
    const segments = phases.flatMap((phase) => [
      { ...prompt, id: `prompt-${phase}`, phase, pauseAfterMs: 2_000, audioUrl: `https://example.com/prompt-${phase}.wav` },
      { ...example, id: `example-${phase}`, phase, audioUrl: `https://example.com/example-${phase}.wav` },
    ]);
    const plan = answerPlan(segments, playbackClips(segments), segments.map(() => 3_000));
    expect(plan?.windows.map(({ id }) => id)).toEqual(phases.map((phase) => `prompt-${phase}`));
    expect(plan?.windows.map(({ feedbackAtSeconds }) => feedbackAtSeconds))
      .toEqual(phases.map((_, index) => (6_000 * index + 2_900) / 1_000));
  });

  it("accepts a model answer at the beginning of shared scene audio", () => {
    const reply: LessonSegment = { ...example, id: "next-line", kind: "dialogue", speaker: "speakerB", text: "Gerne." };
    const segments = [prompt, example, reply];
    expect(answerPlan(segments, playbackClips(segments), [7_000, 3_000])?.windows[0]).toMatchObject({
      answerId: "example",
      expected: "Die Rechnung, bitte.",
      feedbackAtSeconds: 6.9,
    });
    expect(answerPlan(segments, playbackClips(segments), [7_000, 3_000])?.windows[0]?.modelAudioUrl).toBeUndefined();
  });
});
