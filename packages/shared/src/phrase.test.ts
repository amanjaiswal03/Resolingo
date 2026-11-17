import { describe, expect, it } from "vitest";
import { displayLessonSegment, lessonDisplayText } from "./markup.js";
import {
  phraseIdFor,
  phraseIdsToPrune,
  phraseLessonPace,
  phraseLookupLimit,
  phrasePromptsAreClear,
  shapePhraseLesson,
  type PhraseLessonContext,
} from "./phrase.js";
import { phrasesToRemember } from "./review.js";
import { normalizeSpeakerNames } from "./speakers.js";

const shoes: PhraseLessonContext = {
  phraseId: "phrase_ab12cd34",
  nativeLanguage: "en-US",
  targetLanguage: "de-DE",
  level: "A2",
  nativeText: "I need to buy a pair of shoes",
  translation: "Ich muss ein Paar Schuhe kaufen.",
  inputLanguage: "native",
};

const shoesModel = {
  title: "Buying a pair of shoes",
  topic: "I need to buy a pair of shoes",
  summary: "Learn how to say you need to buy a pair of shoes, then change the details.",
  speakerNames: { teacher: "Mira" },
  chunks: [
    { text: "Schuhe", translation: "shoes" },
    { text: "ein Paar Schuhe", translation: "a pair of shoes" },
    { text: "ein Paar Schuhe kaufen", translation: "to buy a pair of shoes" },
  ],
  swaps: [
    { from: "a pair of shoes", to: "a jacket", source: "Ich muss ein Paar Schuhe kaufen.", answer: "Ich muss eine Jacke kaufen.", translation: "I need to buy a jacket" },
    { from: "a pair of shoes", to: "tickets", source: "Ich muss ein Paar Schuhe kaufen.", answer: "Ich muss Tickets kaufen.", translation: "I need to buy tickets" },
    { from: "I need to", to: "I want to", source: "Ich muss ein Paar Schuhe kaufen.", answer: "Ich will ein Paar Schuhe kaufen.", translation: "I want to buy a pair of shoes" },
  ],
  situations: [
    { setup: "You're in a shoe shop. The clerk asks what you're looking for.", answer: "Ich muss ein Paar Schuhe kaufen.", translation: "I need to buy a pair of shoes" },
    { setup: "You're ordering online and the page asks what you need.", answer: "Ich muss ein Paar Schuhe kaufen.", translation: "I need to buy a pair of shoes" },
    { setup: "A friend asks why you're going into town.", answer: "Ich muss ein Paar Schuhe kaufen.", translation: "I need to buy a pair of shoes" },
  ],
  roleplay: {
    setup: "You're in a shop. The clerk asks what you need. Tell them.",
    answer: "Ich muss ein Paar Schuhe kaufen.",
    translation: "I need to buy a pair of shoes",
  },
};

function lessonFor(level: PhraseLessonContext["level"], extra: Partial<PhraseLessonContext> = {}) {
  return shapePhraseLesson(shoesModel, { ...shoes, level, ...extra });
}

describe("phrase lookup ids", () => {
  it("hashes the same query with or without the English frame", () => {
    const framed = phraseIdFor("de-DE", "A2", "How would you say I need to buy a pair of shoes?");
    const plain = phraseIdFor("de-DE", "A2", "I need to buy a pair of shoes");
    expect(framed).toBe(plain);
    expect(framed).toMatch(/^phrase_[0-9a-f]{8}$/);
    expect(phraseIdFor("de-DE", "A1", "I need to buy a pair of shoes")).not.toBe(framed);
  });

  it("keeps the latest 100 phrase ids and caps lookups", () => {
    const ids = Array.from({ length: 103 }, (_, index) => `phrase_${index}`);
    expect(phraseIdsToPrune(ids)).toEqual(["phrase_100", "phrase_101", "phrase_102"]);
    expect(phraseLookupLimit(false)).toBe(30);
    expect(phraseLookupLimit(undefined)).toBe(30);
    expect(phraseLookupLimit(true)).toBe(100);
    expect(phraseLessonPace("A1")).toBe("slow");
    expect(phraseLessonPace("A2")).toBe("slow");
    expect(phraseLessonPace("B1")).toBe("moderate");
    expect(phraseLessonPace("B2")).toBe("natural");
  });
});

describe("phrase lessons", () => {
  const lesson = lessonFor("A2");
  if (!lesson) throw new Error("expected a lesson");

  it("teaches the shoes phrase with one teacher and a bounded script", () => {
    expect(lesson.ruleId).toBe(shoes.phraseId);
    expect(lesson.segments.length).toBeGreaterThanOrEqual(50);
    expect(lesson.segments.length).toBeLessThanOrEqual(70);
    expect(lesson.segments.length).toBeLessThanOrEqual(120);
    expect(lesson.segments.every((segment) => segment.speaker === "teacher")).toBe(true);
    expect(phrasePromptsAreClear(lesson.segments)).toBe(true);
    for (let index = 1; index < lesson.segments.length; index += 1) {
      expect(lesson.segments[index]?.text).not.toBe(lesson.segments[index - 1]?.text);
    }
  });

  it("names the meaning in every recall and never copies the original swap", () => {
    const pauses = lesson.segments.filter((segment) => (segment.pauseAfterMs ?? 0) > 0);
    const counts = new Map<string, number>();
    for (const pause of pauses) counts.set(pause.text, (counts.get(pause.text) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    expect(pauses.some((pause) => pause.text.startsWith("How would you say"))).toBe(true);
    expect(pauses.some((pause) => pause.text.startsWith("Can you say"))).toBe(true);
    expect(pauses.some((pause) => pause.text.includes("Change a pair of shoes to a jacket"))).toBe(true);
    const answers = lesson.segments.filter((segment) => segment.language === "de-DE").map((segment) => segment.text);
    expect(answers).toContain("Ich muss eine Jacke kaufen.");
    expect(answers).toContain("Ich muss Tickets kaufen.");
    expect(answers).toContain("Ich will ein Paar Schuhe kaufen.");
    expect(answers.filter((text) => text === "Ich muss ein Paar Schuhe kaufen.")).not.toContain("Ich muss eine Jacke kaufen.");
  });

  it("strips language tags for display and keeps a gloss for speech", () => {
    const gloss = lesson.segments.find((segment) => segment.text.includes("means \"I need to buy a pair of shoes\""));
    expect(gloss?.text).toContain("[[lang:de-DE]]Ich muss ein Paar Schuhe kaufen[[/lang]]");
    expect(gloss?.text).not.toMatch(/kaufen\.\[\[\/lang\]\]/);
    expect(lessonDisplayText(gloss?.text ?? "")).toBe("Ich muss ein Paar Schuhe kaufen means \"I need to buy a pair of shoes\".");
    for (const segment of lesson.segments.map((item) => displayLessonSegment(item))) {
      expect(segment.text).not.toContain("[[");
    }
  });

  it("uses three situations, one role-play, and a three-line quick fire", () => {
    const setups = lesson.segments.filter((segment) => segment.phase === "situation" && segment.language === "en-US" && !segment.pauseAfterMs);
    expect(setups.map((segment) => segment.text)).toEqual([
      "You're in a shoe shop. The clerk asks what you're looking for.",
      "You're ordering online and the page asks what you need.",
      "A friend asks why you're going into town.",
    ]);
    const roleplay = lesson.segments.filter((segment) => segment.phase === "roleplay" && segment.language === "de-DE");
    expect(roleplay).toHaveLength(1);
    const summaryAt = lesson.segments.findIndex((segment) => segment.phase === "summary");
    const quick = lesson.segments.slice(summaryAt).filter((segment) => segment.phase === "review" && segment.language === "de-DE");
    expect(quick).toHaveLength(3);
  });

  it("keeps A1 shorter, with chunks, and B1 on the whole phrase plus a formal alternative", () => {
    const beginner = lessonFor("A1");
    const later = lessonFor("B1", {
      alternatives: [{ label: "formally", text: "Ich hätte gern ein Paar Schuhe." }],
    });
    expect(beginner).not.toBeNull();
    expect(later).not.toBeNull();
    expect(beginner!.segments.length).toBeLessThan(lesson.segments.length);
    expect(beginner!.segments.some((segment) => segment.phase === "chunk")).toBe(true);
    expect(later!.segments.some((segment) => segment.phase === "chunk")).toBe(false);
    expect(later!.segments.some((segment) => segment.text.includes("more formal"))).toBe(true);
    expect(later!.segments.some((segment) => segment.text === "Ich hätte gern ein Paar Schuhe.")).toBe(true);
    expect(phraseLessonPace("A1")).toBe("slow");
    expect(phraseLessonPace("B1")).toBe("moderate");
  });

  it("does not drill an idiom's literal gloss, and it keeps a name", () => {
    const idiom = shapePhraseLesson({
      ...shoesModel,
      swaps: [
        { from: "pouring", to: "starting", answer: "Es fängt an zu regnen.", translation: "It's starting to rain" },
        { from: "the rain", to: "the weather", answer: "Das Wetter ist schlecht.", translation: "The weather is bad" },
        { from: "today", to: "tonight", answer: "Es regnet heute Nacht in Strömen.", translation: "It's raining cats and dogs tonight" },
      ],
    }, {
      ...shoes,
      nativeText: "It's raining cats and dogs",
      translation: "Es regnet in Strömen.",
      note: "Literally, that is cats and dogs.",
    });
    expect(idiom).not.toBeNull();
    const notes = idiom!.segments.filter((segment) => segment.text === "Literally, that is cats and dogs.");
    expect(notes).toHaveLength(1);
    expect(idiom!.segments.some((segment) => segment.language === "de-DE" && segment.text.includes("cats and dogs"))).toBe(false);
    expect(idiom!.segments.some((segment) => segment.text.includes("not the word-for-word"))).toBe(true);

    const named = shapePhraseLesson({
      ...shoesModel,
      swaps: [
        { from: "the station", to: "the café", answer: "Ich muss Anna im Café treffen.", translation: "I need to meet Anna at the café" },
        { from: "Anna", to: "Lukas", answer: "Ich muss Lukas am Bahnhof treffen.", translation: "I need to meet Lukas at the station" },
        { from: "I need to", to: "I want to", answer: "Ich will Anna am Bahnhof treffen.", translation: "I want to meet Anna at the station" },
      ],
    }, {
      ...shoes,
      nativeText: "I need to meet Anna at the station",
      translation: "Ich muss Anna am Bahnhof treffen.",
    });
    expect(named!.segments.some((segment) => segment.text.includes("Anna"))).toBe(true);
    expect(named!.segments.some((segment) => segment.text === "Anna")).toBe(false);
  });

  it("says when the learner already used the target language", () => {
    const known = lessonFor("A2", { inputLanguage: "target" });
    expect(known!.segments[0]?.text).toContain("You already said this in German");
    const mixed = lessonFor("A2", { inputLanguage: "mixed" });
    expect(mixed!.segments[0]?.text).toContain("Part of that was already in German");
  });

  it("rejects swaps that are copies of the original sentence", () => {
    const rejected = shapePhraseLesson({
      ...shoesModel,
      swaps: [
        { from: "shoes", to: "shoes", answer: "Ich muss ein Paar Schuhe kaufen.", translation: "I need to buy a pair of shoes" },
        { from: "a pair of shoes", to: "a jacket", answer: "Ich muss eine Jacke kaufen.", translation: "I need to buy a jacket" },
      ],
    }, shoes);
    expect(rejected).toBeNull();
  });

  it("remembers the full lines and not the chunks", () => {
    const remembered = phrasesToRemember(lesson.segments, normalizeSpeakerNames({ teacher: "Mira" }), "de-DE");
    expect(remembered.map((item) => item.text)).toContain("Ich muss ein Paar Schuhe kaufen.");
    expect(remembered.map((item) => item.text)).toContain("Ich muss eine Jacke kaufen.");
    expect(remembered.map((item) => item.text)).not.toContain("Schuhe");
    expect(remembered.every((item) => item.speaker === "speakerA")).toBe(true);
  });
});
