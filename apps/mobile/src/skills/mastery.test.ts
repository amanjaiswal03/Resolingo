import { grammarTopics, type CefrLevel, type Lesson, type LanguageId } from "@resolingo/shared";
import { describe, expect, it } from "vitest";
import { grammarRules } from "./goals";
import { lessonCredits } from "./lesson-credits";
import {
  masteryLevel, phraseFamilies, reviewDaysThisWeek, reviewQuestions, scheduleLessonCredit, scheduleReview, skillMastery,
  type LanguagePair, type ProgressByCard, type ReviewProgress, type SkillCard,
} from "./model";
import { wordMatches } from "../lesson/phrase-match";

const german: LanguagePair = { nativeLanguage: "en-US", targetLanguage: "de-DE" };
const DAY = 86_400_000;
const now = Date.parse("2026-11-22T10:00:00.000Z");
const id = "e266c7a8-cd2b-4b20-9179-3fec548b603d";
const card = (target: string, meaning = target): SkillCard => ({ id: target, target, meaning });

describe("phrase strength", () => {
  it("climbs from New to Mastered only through spaced correct recalls", () => {
    expect(masteryLevel(undefined)).toBe(0);
    let progress: ReviewProgress | undefined;
    const levels: number[] = [];
    let at = now;
    for (let step = 0; step < 5; step += 1) {
      progress = scheduleReview(progress, { attemptId: id, mode: "recall", rating: "got-it", now: at });
      levels.push(masteryLevel(progress));
      at = progress.dueAt;
    }
    expect(levels).toEqual([2, 3, 3, 4, 4]);
    const missed = scheduleReview(progress, { attemptId: id, mode: "recall", rating: "forgot", now: at });
    expect(masteryLevel(missed)).toBe(1);
  });

  it("averages a skill and counts phrases at each level", () => {
    const cards = [card("a"), card("b"), card("c"), card("d")];
    const progress: ProgressByCard = {
      b: scheduleReview(undefined, { attemptId: id, mode: "recall", rating: "forgot", now }),
      c: scheduleReview(undefined, { attemptId: id, mode: "recall", rating: "got-it", now }),
      d: { ...scheduleReview(undefined, { attemptId: id, mode: "recall", rating: "got-it", now }), intervalDays: 24 },
    };
    expect(skillMastery(cards, progress)).toEqual({ percent: 44, level: 1, counts: [1, 1, 1, 0, 1] });
    expect(skillMastery([], progress)).toEqual({ percent: 0, level: 0, counts: [0, 0, 0, 0, 0] });
  });
});

describe("lesson credit", () => {
  it("lifts a phrase to Familiar over two lessons and never past it", () => {
    const first = scheduleLessonCredit(undefined, { attemptId: id, matched: true, now });
    expect(first && masteryLevel(first)).toBe(1);
    expect(scheduleLessonCredit(first!, { attemptId: id, matched: true, now: now + 3_600_000 })).toBeNull();
    const second = scheduleLessonCredit(first!, { attemptId: id, matched: true, now: now + DAY });
    expect(second && masteryLevel(second)).toBe(2);
    expect(scheduleLessonCredit(second!, { attemptId: id, matched: true, now: now + 2 * DAY })).toBeNull();
    const strong = { ...scheduleReview(undefined, { attemptId: id, mode: "recall", rating: "got-it", now }), intervalDays: 12, dueAt: now + 12 * DAY };
    expect(scheduleLessonCredit(strong, { attemptId: id, matched: true, now: now + DAY })).toBeNull();
  });

  it("brings a missed line back tomorrow and keeps the recall history", () => {
    const recalled = scheduleReview(undefined, { attemptId: id, mode: "recall", rating: "got-it", now });
    const missed = scheduleLessonCredit(recalled, { attemptId: id, matched: false, now: now + DAY });
    expect(missed).toMatchObject({ lastMode: "lesson", lastRating: "almost", intervalDays: 1, recallRating: "got-it", dueAt: now + 2 * DAY });
    expect(scheduleLessonCredit(missed!, { attemptId: id, matched: false, now: now + 2 * DAY })).toBeNull();
  });

  it("credits each phrase once from a lesson's checked answers and skips buildup pieces", () => {
    const lesson = {
      id: "l1", type: "conversation", nativeLanguage: "en-US", targetLanguage: "de-DE",
      segments: [
        { id: "p1", kind: "drill", phase: "practice", language: "en-US", speaker: "teacher", text: "Say: the bill" },
        { id: "a1", kind: "drill", phase: "practice", language: "de-DE", speaker: "speakerA", text: "Die Rechnung, bitte.", translation: "The bill, please." },
        { id: "p2", kind: "drill", phase: "review", language: "en-US", speaker: "teacher", text: "Again" },
        { id: "a2", kind: "drill", phase: "review", language: "de-DE", speaker: "speakerA", text: "Die Rechnung, bitte.", translation: "The bill, please." },
        { id: "p3", kind: "drill", phase: "buildup", language: "en-US", speaker: "teacher", text: "bitte" },
        { id: "a3", kind: "drill", phase: "buildup", language: "de-DE", speaker: "speakerA", text: "bitte", translation: "please" },
      ],
    } as unknown as Lesson;
    const window = (prompt: string, answerId: string, expected: string) => ({ id: prompt, answerId, expected, startSeconds: 0, endSeconds: 1, feedbackAtSeconds: 1 });
    const plan = { language: "de-DE" as const, windows: [window("p1", "a1", "Die Rechnung, bitte."), window("p2", "a2", "Die Rechnung, bitte."), window("p3", "a3", "bitte")] };
    const credits = lessonCredits(lesson, plan, {
      p1: { verdict: "unclear", heard: "Hallo zusammen" },
      p2: { verdict: "recalled", heard: "Die Rechnung bitte" },
      p3: { verdict: "recalled", heard: "bitte" },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]?.matched).toBe(true);
    expect(lessonCredits(lesson, plan, { p1: { verdict: "skipped" } })).toEqual([]);
  });
});

describe("variations", () => {
  it("groups near-duplicates and asks only one of them in a session", () => {
    const cards = [
      card("Ich hätte gern einen Kaffee"), card("Ich hätte gern einen Tee"),
      card("Wo ist der Bahnhof?"), card("Die Rechnung, bitte."), card("Die Suppe, bitte."),
    ];
    const families = phraseFamilies(cards, german);
    expect(families.get("Ich hätte gern einen Tee")).toBe("Ich hätte gern einen Kaffee");
    expect(families.get("Die Suppe, bitte.")).toBe("Die Suppe, bitte.");
    const asked = reviewQuestions(cards, {}, german, now, false, families).map((question) => question.card.id);
    expect(asked).toHaveLength(4);
    expect(asked.filter((target) => target.startsWith("Ich hätte"))).toHaveLength(1);
  });
});

describe("weekly goal", () => {
  it("marks the days of this week with a Skills review, not lesson credits", () => {
    const wednesday = new Date(2026, 10, 25, 18).getTime();
    const review = (at: number, mode: ReviewProgress["lastMode"] = "recall"): ReviewProgress =>
      ({ attemptId: id, lastRating: "got-it", lastMode: mode, recallRating: "got-it", reviewedAt: at, dueAt: at + 3 * DAY, intervalDays: 3 });
    const days = reviewDaysThisWeek({
      a: review(new Date(2026, 10, 23, 9).getTime()),
      b: review(new Date(2026, 10, 25, 8).getTime()),
      c: review(new Date(2026, 10, 24, 9).getTime(), "lesson"),
      d: review(new Date(2026, 10, 21, 9).getTime()),
    }, wednesday);
    expect(days).toEqual([true, false, true, false, false, false, false]);
  });
});

describe("spoken answer highlights", () => {
  it("marks a dropped article even when grading forgives it", () => {
    expect(wordMatches("Wo ist der Bahnhof?", "Wo ist Bahnhof", "de-DE")).toEqual([
      { text: "Wo", matched: true }, { text: "ist", matched: true }, { text: "der", matched: false }, { text: "Bahnhof?", matched: true },
    ]);
    expect(wordMatches("Ich hätte gern einen Kaffee.", "ich hatte gern einen kaffee", "de-DE").every((word) => word.matched)).toBe(true);
  });
});

describe("grammar goals", () => {
  it("files every catalog topic under a goal", () => {
    const mapped = new Set(Object.values(grammarRules).flat());
    const levels: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1"];
    const languages: LanguageId[] = ["de-DE", "es-ES", "fr-FR", "it-IT"];
    const missing = languages.flatMap((language) => levels.flatMap((level) => grammarTopics(language, level)))
      .map((topic) => topic.id).filter((topicId) => !mapped.has(topicId));
    expect([...new Set(missing)]).toEqual([]);
  });
});
