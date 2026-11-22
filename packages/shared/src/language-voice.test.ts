import { describe, expect, it } from "vitest";
import { grammarTopics, shapeGrammarLesson } from "./grammar.js";
import { applyTargetVoices, speechSpans, untaggedTargetTokens } from "./markup.js";
import { shapePhraseLesson, type PhraseLessonContext } from "./phrase.js";
import { shapePimsleurLesson } from "./pimsleur.js";
import type { LessonSegment } from "./schemas.js";

function languagesOf(text: string, base: LessonSegment["language"] = "en-US") {
  return speechSpans(text, base).map((span) => `${span.language}:${span.text.trim()}`).filter((span) => span.split(":")[1]);
}

describe("target words use the target voice", () => {
  const mixed = applyTargetVoices([
    { language: "de-DE" as const, text: "Ich komme zu spät.", translation: "I'm running late." },
    { language: "de-DE" as const, text: "jetzt", translation: "now" },
    { language: "de-DE" as const, text: "Wo ist der Bahnhof?", translation: "Where is the station?" },
    { language: "en-US" as const, text: "spät means 'late'." },
    { language: "en-US" as const, text: "Instead of faster, now: jetzt" },
    { language: "en-US" as const, text: "In the recap, remember \"Wo ist der Bahnhof?\"." },
  ], "en-US", "de-DE");

  it("keeps German out of the English span in a gloss, a swap cue, and a conversation recap", () => {
    expect(mixed.leftover).toEqual([]);
    const [gloss, swap, recap] = mixed.segments.slice(3).map((segment) => segment.text);
    expect(languagesOf(gloss!)).toEqual(["de-DE:spät", "en-US:means 'late'."]);
    expect(languagesOf(swap!)).toEqual(["en-US:Instead of faster, now:", "de-DE:jetzt"]);
    expect(languagesOf(recap!)).toEqual(["en-US:In the recap, remember \"", "de-DE:Wo ist der Bahnhof?", "en-US:\"."]);
    for (const segment of mixed.segments.filter((item) => item.language === "en-US")) {
      const english = speechSpans(segment.text, "en-US").filter((span) => span.language === "en-US").map((span) => span.text).join(" ");
      expect(english).not.toMatch(/spät|jetzt|Bahnhof/);
    }
  });

  it("tags a grammar explanation, a phrase closing, and a conversation gloss", () => {
    const topic = grammarTopics("de-DE", "A1").find((item) => item.id === "de-sein");
    const grammar = shapeGrammarLesson({}, {
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "A1",
      topic: topic!,
    });
    const welcome = grammar?.segments[0]?.text ?? "";
    expect(languagesOf(welcome)).toContain("de-DE:sein");
    expect(speechSpans(welcome, "en-US").filter((span) => span.language === "en-US").join(" ")).not.toMatch(/\bsein\b/);
    const rule = grammar?.segments.find((segment) => segment.phase === "rule")?.text ?? "";
    expect(untaggedTargetTokens(rule, "en-US", "de-DE", ["bin", "bist", "ist"], new Set(["i", "am", "tired"]))).toEqual([]);
    expect(speechSpans(rule, "en-US").some((span) => span.language === "de-DE" && span.text.includes("bin"))).toBe(true);

    const phrase = shapePhraseLesson({
      title: "Running late",
      topic: "Running late",
      summary: "Say that you are running late.",
      speakerNames: { teacher: "Mira" },
      pattern: "Schneller comes before the place, and kommen stays at the end.",
      chunks: [
        { text: "spät", translation: "late" },
        { text: "komme", translation: "am coming" },
        { text: "kommen", translation: "to get" },
      ],
      swaps: [
        { from: "faster", to: "now", focus: "jetzt", focusTranslation: "now", answer: "Ich komme jetzt.", translation: "I'm coming now." },
        { from: "there", to: "home", focus: "nach Hause", focusTranslation: "home", answer: "Ich komme nach Hause.", translation: "I'm coming home." },
      ],
      situations: [
        { setup: "You're calling from the station.", focus: "zum Bahnhof", focusTranslation: "to the station", answer: "Ich komme zum Bahnhof.", translation: "I'm coming to the station." },
        { setup: "You're in a taxi.", focus: "sofort", focusTranslation: "right away", answer: "Ich komme sofort.", translation: "I'm coming right away." },
      ],
      roleplay: { setup: "You're in a taxi.", answer: "Ich komme sofort.", translation: "I'm coming right away." },
    }, {
      phraseId: "phrase_late0001",
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "A1",
      nativeText: "I'm coming faster.",
      translation: "Ich komme schneller.",
    } satisfies PhraseLessonContext);
    expect(phrase.ok).toBe(true);
    if (!phrase.ok) return;
    const pattern = phrase.lesson.segments.find((segment) => segment.phase === "pattern")?.text ?? "";
    expect(languagesOf(pattern)).toEqual([
      "de-DE:Schneller",
      "en-US:comes before the place, and",
      "de-DE:kommen",
      "en-US:stays at the end.",
    ]);
    const closing = phrase.lesson.segments.find((segment) => segment.phase === "closing")?.text ?? "";
    expect(speechSpans(closing, "en-US").every((span) => span.language === "en-US" || span.language === "de-DE")).toBe(true);
    expect(speechSpans(closing, "en-US").filter((span) => span.language === "en-US").map((span) => span.text).join(" ")).not.toMatch(/[äöüÄÖÜß]/u);

    const conversation = shapePimsleurLesson({
      title: "At the station",
      topic: "Asking the way",
      summary: "Ask where the station is.",
      cues: { closing: "Remember this from the conversation: \"Wo ist der Bahnhof?\"." },
      lines: [
        { speaker: "speakerA", text: "Wo ist der Bahnhof?", translation: "Where is the station?", language: "de-DE" },
        { speaker: "speakerB", text: "Geradeaus.", translation: "Straight ahead.", language: "de-DE" },
        { speaker: "speakerA", text: "Danke.", translation: "Thanks.", language: "de-DE" },
      ],
      phrases: [{
        speaker: "speakerA",
        text: "Wo ist der Bahnhof?",
        translation: "Where is the station?",
        chunks: [{ text: "Bahnhof", gloss: "Bahnhof means the station." }],
      }],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A1" });
    const remembered = conversation?.segments.find((segment) => segment.text.includes("Remember this"))?.text ?? "";
    expect(languagesOf(remembered).filter((span) => span.startsWith("de-DE"))).toEqual(["de-DE:Wo ist der Bahnhof?"]);
    const gloss = conversation?.segments.find((segment) => segment.kind === "explanation" && segment.phase === "buildup")?.text ?? "";
    expect(languagesOf(gloss)).toContain("de-DE:Bahnhof");
    expect(speechSpans(gloss, "en-US").filter((span) => span.language === "en-US").join(" ")).not.toMatch(/Bahnhof/);
  });
});
