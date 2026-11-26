import { describe, expect, it } from "vitest";
import { isGlossedAnswer, targetAnswerText, tidyTargetAnswers } from "./answer-text.js";
import { phrasesToRemember, reviewAsPhrase, reviewItemId, type ReviewItem } from "./review.js";
import type { LessonSegment } from "./schemas.js";

const de = { language: "de-DE" } as const;

describe("targetAnswerText", () => {
  it("cuts a quoted gloss back to the target words", () => {
    expect(targetAnswerText("'Das Kind' means 'The Child'", { ...de, translation: "the child" })).toBe("Das Kind");
    expect(targetAnswerText("\"Das Kind\" means \"the child\".", de)).toBe("Das Kind");
    expect(targetAnswerText("„Das Kind“ bedeutet „das Kind“.", { language: "en-US" })).toBe("Das Kind");
  });

  it("cuts an unquoted gloss when the rest is the meaning or in another language", () => {
    expect(targetAnswerText("Das Kind means the child", { translation: "the child" })).toBe("Das Kind");
    expect(targetAnswerText("Ich hätte gern einen Kaffee is how you say I'd like a coffee", de)).toBe("Ich hätte gern einen Kaffee");
  });

  it("drops a trailing translation in brackets or after a dash", () => {
    expect(targetAnswerText("Das Kind (the child)", { ...de, translation: "the child" })).toBe("Das Kind");
    expect(targetAnswerText("Das Kind — the child.", { ...de, translation: "The child." })).toBe("Das Kind");
    expect(targetAnswerText("Danke: thanks", { ...de, translation: "Thanks" })).toBe("Danke");
  });

  it("unquotes a line wrapped in quotes", () => {
    expect(targetAnswerText("„Hallo Mia, hast du kurz Zeit?“", de)).toBe("Hallo Mia, hast du kurz Zeit?");
    expect(targetAnswerText("'Das Kind'", de)).toBe("Das Kind");
  });

  it("leaves real target lines alone", () => {
    const lines: Array<[string, string, string]> = [
      ["Was bedeutet das?", "What does that mean?", "de-DE"],
      ["Eso significa mucho para mí.", "That means a lot to me.", "es-ES"],
      ["Questo significa molto.", "This means a lot.", "it-IT"],
      ["That means a lot to me.", "Das bedeutet mir viel.", "en-US"],
      ["What's the meaning of this?", "Was soll das?", "en-US"],
      ["Ja - klar, gern.", "Yes, sure, gladly.", "de-DE"],
      ["Kann ich deine Bohrmaschine ausleihen?", "Can I borrow your drill?", "de-DE"],
      ["私は学生です。", "I am a student.", "ja-JP"],
    ];
    for (const [text, translation, language] of lines) {
      expect(targetAnswerText(text, { translation, language })).toBe(text);
      expect(isGlossedAnswer(text, { translation, language })).toBe(false);
    }
  });

  it("keeps the tagged words when a whole teaching gloss was stored as the line", () => {
    expect(targetAnswerText("[[lang:de-DE]]Das Kind[[/lang]] means \"the child\".", de)).toBe("Das Kind");
  });
});

describe("tidyTargetAnswers", () => {
  it("cleans recall answers but not teaching lines", () => {
    const segments: LessonSegment[] = [
      { id: "seg_01", kind: "drill", phase: "warmup", speaker: "teacher", language: "en-US", text: "Can you recall how to say the child?", delivery: "curious", pauseAfterMs: 6000 },
      { id: "seg_02", kind: "drill", phase: "warmup", speaker: "speakerA", language: "de-DE", text: "'Das Kind' means 'The Child'", translation: "the child", delivery: "clear" },
      { id: "seg_03", kind: "explanation", phase: "hook", speaker: "teacher", language: "en-US", text: "[[lang:de-DE]]Das Kind[[/lang]] means \"the child\".", delivery: "clear" },
    ] as LessonSegment[];
    const tidy = tidyTargetAnswers(segments, "de-DE");
    expect(tidy[0]).toBe(segments[0]);
    expect(tidy[1]!.text).toBe("Das Kind");
    expect(tidy[2]).toBe(segments[2]);
  });
});

describe("reviews never carry a gloss", () => {
  const names = { teacher: "Mira", speakerA: "Lukas", speakerB: "Anna" };

  it("stores the target words only", () => {
    const segments = [
      { id: "seg_01", kind: "drill", phase: "answer", speaker: "speakerA", language: "de-DE", text: "'Das Kind' means 'The Child'", translation: "the child", delivery: "clear" },
    ] as LessonSegment[];
    expect(phrasesToRemember(segments, names, "de-DE")).toEqual([{ text: "Das Kind", translation: "the child", speaker: "speakerA" }]);
  });

  it("asks an item saved by an older lesson with the target words only", () => {
    const item: ReviewItem = {
      id: reviewItemId("de-DE", "'Das Kind' means 'The Child'"),
      text: "'Das Kind' means 'The Child'",
      translation: "the child",
      language: "de-DE",
      nativeLanguage: "en-US",
      speaker: "speakerA",
      strength: 1,
      intervalDays: 1,
      lastSeen: "2026-11-20T00:00:00.000Z",
      dueAt: "2026-11-21T00:00:00.000Z",
    };
    expect(reviewAsPhrase(item).text).toBe("Das Kind");
  });
});
