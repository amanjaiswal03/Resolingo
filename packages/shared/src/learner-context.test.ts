import { describe, expect, it } from "vitest";
import { conversationMemory, grammarMemory, parseConversationMemory, parseGrammarMemory } from "./learner-context.js";
import { findKnownPhrase, phraseSimilarity } from "./review.js";
import type { LessonSegment } from "./schemas.js";

const segment = (id: number, phase: string, text: string, translation?: string, language = "de-DE"): LessonSegment => ({
  id: `seg_${id}`, kind: "example", speaker: "teacher", delivery: "warm", phase, language: language as LessonSegment["language"], text,
  ...(translation ? { translation } : {}),
});

describe("learner context", () => {
  it("remembers the examples of a grammar lesson and the lines of a conversation", () => {
    const grammar = grammarMemory({
      title: "Saying what you must do",
      topic: "Modal verbs",
      ruleId: "de-modals",
      segments: [
        segment(1, "intro", "Today: modal verbs.", undefined, "en-US"),
        segment(2, "hook", "[[lang:de-DE]]Ich muss arbeiten.[[/lang]]", "I have to work."),
        segment(3, "example", "Du musst gehen.", "You have to go."),
        segment(4, "practice", "Wir müssen gehen.", "We have to go."),
      ],
    }, "de-DE");
    expect(grammar).toEqual({
      ruleId: "de-modals",
      title: "Modal verbs",
      examples: [{ text: "Ich muss arbeiten.", translation: "I have to work." }, { text: "Du musst gehen.", translation: "You have to go." }],
    });
    const conversation = conversationMemory({
      title: "At the café",
      topic: "Ordering a coffee",
      segments: [segment(1, "dialogue", "Einen Kaffee, bitte.", "A coffee, please."), segment(2, "dialogue", "Gern.", "Sure."), segment(3, "closing", "Gern.", "Sure.")],
    }, "de-DE");
    expect(conversation.lines.map((line) => line.text)).toEqual(["Einen Kaffee, bitte.", "Gern."]);
    expect(parseGrammarMemory(grammar)).toEqual(grammar);
    expect(parseConversationMemory(conversation)).toEqual(conversation);
    expect(parseGrammarMemory({ examples: [] })).toBeUndefined();
    expect(parseConversationMemory({ title: "No lines", lines: [{ text: "Hallo" }] })).toBeUndefined();
  });

  it("treats a repeat or a one-word variant as known, but not a line that only shares a word", () => {
    expect(phraseSimilarity("Einen Kaffee, bitte.", "einen kaffee bitte", "de-DE")).toBe(1);
    const known = [{ text: "Kann ich bitte die Rechnung haben?" }, { text: "Danke." }];
    expect(findKnownPhrase("Kann ich bitte die Speisekarte haben?", known, "de-DE")).toBeUndefined();
    expect(findKnownPhrase("Kann ich die Rechnung bitte haben?", known, "de-DE")?.text).toBe("Kann ich bitte die Rechnung haben?");
    expect(findKnownPhrase("Danke!", known, "de-DE")?.text).toBe("Danke.");
    expect(findKnownPhrase("Danke schön.", known, "de-DE")).toBeUndefined();
    expect(findKnownPhrase("駅はどこですか。", [{ text: "駅はどこですか" }], "ja-JP")).toBeDefined();
  });
});
