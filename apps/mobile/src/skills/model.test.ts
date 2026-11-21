import type { Lesson, LessonSegment, Phrase } from "@resolingo/shared";
import { describe, expect, it } from "vitest";
import { buildSkills, lessonLanguagePair, progressForCard, reviewIsDue, reviewQuestions, scheduleReview, type LanguagePair, type SkillCard } from "./model";

const german: LanguagePair = { nativeLanguage: "en-US", targetLanguage: "de-DE" };
const at = "2026-11-21T09:00:00.000Z";
const intro: LessonSegment = { id: "intro", kind: "narration", phase: "intro", language: "en-US", speaker: "teacher", text: "Today at a café.", delivery: "warm" };
const answer: LessonSegment = { id: "answer", kind: "drill", phase: "answer", language: "de-DE", speaker: "speakerA", text: "Die Rechnung, bitte.", translation: "The bill, please.", delivery: "clear", audioPath: "lesson/model.wav" };
const café: Lesson = {
  id: "cafe", type: "conversation", status: "ready", progress: 100, completed: true,
  createdAt: at, updatedAt: at, quotaDate: "2026-11-21", title: "At the café",
  topic: "Ordering at a café", summary: "Ask for a coffee and the bill.",
  segments: [intro, answer], speakerNames: { teacher: "Nora", speakerA: "Leo", speakerB: "Mia" },
};
const saved: Phrase = {
  id: "phrase_0288aaaa", level: "A1", ...german, nativeText: "The bill, please.",
  translation: "Die Rechnung, bitte.", inputLanguage: "native", alternatives: [],
  createdAt: at, updatedAt: at, audioPath: "phrase/preview.wav",
};
const clock = Date.parse(at);
const attemptId = "e266c7a8-cd2b-4b20-9179-3fec548b603d";

describe("Skills content", () => {
  it("merges the same example from a completed lesson and Say", () => {
    const map = buildSkills([café], [saved], german);
    expect(map.cards).toHaveLength(1);
    expect(map.conversations[0]?.title).toBe("Order food and drinks");
    expect(map.phrases[0]).toMatchObject({ id: map.conversations[0]?.cards[0]?.id, practicedAt: at, phraseId: saved.id });
  });

  it("shows nothing from an unfinished lesson or another language pair", () => {
    expect(buildSkills([{ ...café, completed: false }], [saved], german).phrases[0]?.practicedAt).toBeUndefined();
    expect(buildSkills([café], [saved], { ...german, nativeLanguage: "fr-FR" }).cards).toEqual([]);
    expect(lessonLanguagePair({ ...café, segments: [intro, answer, { ...answer, id: "other", language: "fr-FR" }] })).toBeNull();
  });

  it("uses grammar catalog names and preserves a completed Say lesson's practice record", () => {
    const grammar = { ...café, id: "grammar", type: "grammar" as const, ruleId: "de-v2" };
    const phraseLesson = { ...café, id: "phrase-lesson", type: "phrase" as const, phraseId: saved.id };
    expect(buildSkills([grammar], [], german).grammar[0]?.patterns?.[0]?.title).toBe("The verb in second position");
    const map = buildSkills([phraseLesson], [saved], german);
    expect(map.phrases[0]?.practicedAt).toBe(at);
  });

  it("does not play a whole scene as if it were one model phrase", () => {
    const lesson = { ...café, segments: [intro, answer, { ...answer, id: "reply", text: "Gerne.", translation: "Of course." }] };
    expect(buildSkills([lesson], [], german).cards.every((card) => !card.audioPath)).toBe(true);
  });

  it("groups different scenes by goal and shows repeated phrases once across grammar and conversation", () => {
    const dinner: Lesson = {
      ...café, id: "dinner", topic: "Dinner with a friend",
      segments: [intro, { ...answer, translation: "Could I have the check, please?" }],
    };
    const questions: Lesson = { ...café, id: "questions", type: "grammar", ruleId: "de-questions" };
    const map = buildSkills([café, dinner, questions], [], german);
    const shared = map.conversations[0]?.cards[0];
    expect(map.conversations.map((group) => group.title)).toEqual(["Order food and drinks"]);
    expect(map.cards).toHaveLength(1);
    expect(shared?.lessonCount).toBe(3);
    expect(shared?.otherMeanings).toEqual(["Could I have the check, please?"]);
    expect(map.grammar[0]?.cards).toEqual([]);
    expect(map.grammar[0]?.reviewCards).toEqual([shared]);
  });

  it("groups distinct grammar patterns under the same learner goal", () => {
    const lessons: Lesson[] = [
      { ...café, id: "past1", type: "grammar", ruleId: "de-perfekt-haben" },
      { ...café, id: "past2", type: "grammar", ruleId: "de-perfekt-sein" },
    ];
    const map = buildSkills(lessons, [], german);
    expect(map.grammar.map((group) => group.title)).toEqual(["Talk about the past"]);
    expect(map.grammar[0]?.patterns?.map((pattern) => pattern.id)).toEqual(["de-perfekt-haben", "de-perfekt-sein"]);
  });

  it("uses a stored skill goal even when the generated lesson title is unrelated", () => {
    const map = buildSkills([{ ...café, title: "A morning errand", topic: "A chat with Emil", conversationSkill: "get-around" }], [], german);
    expect(map.conversations[0]?.title).toBe("Get around and ask for directions");
  });
});

describe("Skills review", () => {
  const pool: SkillCard[] = [
    { id: "bill", target: "Die Rechnung, bitte.", meaning: "The bill, please." },
    { id: "coffee", target: "Einen Kaffee, bitte.", meaning: "A coffee, please." },
    { id: "hello", target: "Hallo.", meaning: "Hello." },
    { id: "later", target: "Bis später.", meaning: "See you later." },
    { id: "morning", target: "Guten Morgen.", meaning: "Good morning." },
    { id: "thanks", target: "Danke.", meaning: "Thanks." },
  ];

  it("starts with missed material that is due and uses at most five prompts", () => {
    const forgotten = scheduleReview(undefined, { rating: "forgot", mode: "recall", now: clock - 90_000_000, attemptId });
    const future = scheduleReview(undefined, { rating: "got-it", mode: "recall", now: clock, attemptId });
    const questions = reviewQuestions(pool, { thanks: forgotten, bill: future }, german, clock, true);
    expect(questions).toHaveLength(5);
    expect(questions[0]?.card.id).toBe("thanks");
    expect(questions.some((item) => item.card.id === "bill")).toBe(false);
    const recognition = questions.find((item) => item.mode === "recognition");
    expect(recognition?.options).toHaveLength(3);
    expect(recognition?.options).toContain(recognition?.card.meaning);
  });

  it("schedules missed phrases sooner and keeps recognition separate from recall", () => {
    const recalled = scheduleReview(undefined, { rating: "got-it", mode: "recall", now: clock, attemptId });
    const missed = scheduleReview(recalled, { rating: "forgot", mode: "recognition", now: clock, attemptId });
    expect(missed.dueAt).toBeLessThan(recalled.dueAt);
    expect(missed.recallRating).toBe("got-it");
    expect(reviewIsDue(missed, missed.dueAt)).toBe(true);
  });

  it("only grows the spacing after a successful recall when the phrase comes due", () => {
    const recalled = scheduleReview(undefined, { rating: "got-it", mode: "recall", now: clock, attemptId });
    const sameDay = scheduleReview(recalled, { rating: "got-it", mode: "recall", now: clock + 60_000, attemptId });
    const whenDue = scheduleReview(sameDay, { rating: "got-it", mode: "recall", now: sameDay.dueAt, attemptId });
    expect(sameDay.intervalDays).toBe(3);
    expect(whenDue.intervalDays).toBe(6);
  });

  it("keeps prior review progress when merging the translations of a phrase", () => {
    const card = buildSkills([café], [], german).cards[0]!;
    const previousId = card.previousIds?.[0]!;
    const prior = scheduleReview(undefined, { rating: "got-it", mode: "recall", now: clock, attemptId });
    expect(progressForCard(card, { [previousId]: prior })).toEqual(prior);
    expect(reviewQuestions([card], { [previousId]: prior }, german, clock, true)).toEqual([]);
  });
});
