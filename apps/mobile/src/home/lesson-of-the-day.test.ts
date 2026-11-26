import { describe, expect, it } from "vitest";
import type { DailyPick, Lesson } from "@resolingo/shared";
import { countsTowardCap, pickCardState, pickDateLabel, showPickCard } from "./lesson-of-the-day";

const pick = (extra: Partial<DailyPick> = {}): DailyPick => ({
  kind: "daily",
  date: "2026-11-24",
  type: "conversation",
  level: "A2",
  title: "Order a coffee to take away",
  reason: "use-grammar",
  why: "Puts Present tense of sein to work",
  scenario: "Order a coffee to take away",
  ...extra,
});

const lesson = (extra: Partial<Lesson>): Lesson => ({
  id: "l1",
  type: "conversation",
  status: "ready",
  progress: 100,
  quotaDate: "2026-11-24",
  title: "Kaffee to go",
  topic: "",
  summary: "",
  speakerNames: { teacher: "Mia", speakerA: "Leo", speakerB: "Ana" },
  segments: [],
  completed: false,
  createdAt: "2026-11-24T08:00:00.000Z",
  updatedAt: "2026-11-24T08:00:00.000Z",
  ...extra,
});

describe("lesson of the day card", () => {
  it("shows only the topic until the learner starts it", () => {
    const planned = pickCardState({ pick: pick(), lessons: [], capReached: false });
    expect(planned).toEqual({ kind: "planned", retry: false });
    expect(showPickCard(planned)).toBe(true);
  });

  it("follows the lesson from preparing to ready to done", () => {
    const started = pick({ lessonId: "l1" });
    const preparing = pickCardState({ pick: started, lessons: [], capReached: false });
    expect(preparing).toEqual({ kind: "preparing", progress: 5 });
    expect(showPickCard(preparing)).toBe(false);
    expect(pickCardState({ pick: started, lessons: [lesson({ status: "synthesizing_audio", progress: 60 })], capReached: false }))
      .toEqual({ kind: "preparing", progress: 60 });
    expect(pickCardState({ pick: started, lessons: [lesson({})], capReached: true }).kind).toBe("ready");
    expect(pickCardState({ pick: started, lessons: [lesson({ completed: true })], capReached: true }).kind).toBe("done");
  });

  it("lets a failed lesson start again, unless the day's lessons are used up", () => {
    const started = pick({ lessonId: "l1" });
    const retry = pickCardState({ pick: started, lessons: [lesson({ status: "failed" })], capReached: false });
    expect(retry).toEqual({ kind: "planned", retry: true });
    expect(showPickCard(retry)).toBe(true);
    expect(pickCardState({ pick: started, lessons: [lesson({ status: "failed" })], capReached: true })).toEqual({ kind: "blocked" });
  });

  it("never blocks the welcome lesson on the daily cap", () => {
    expect(pickCardState({ pick: pick({ kind: "welcome", reason: "welcome" }), lessons: [], capReached: true }).kind).toBe("planned");
    expect(countsTowardCap(lesson({ plan: { kind: "welcome", date: "2026-11-24" } }))).toBe(false);
    expect(countsTowardCap(lesson({}))).toBe(true);
  });

  it("labels the calendar day without shifting it", () => {
    expect(pickDateLabel("2026-11-24")).toBe("Tue 24 Nov");
    expect(pickDateLabel("bad")).toBe("");
  });
});
