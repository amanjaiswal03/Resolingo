import { describe, expect, it } from "vitest";
import { shapeGrammarLesson, grammarTopics, selectGrammarTopic, grammarPromptsAreClear } from "./grammar.js";
import { GeneratedLessonSchema } from "./schemas.js";
import { phrasesToRemember } from "./review.js";
import { DEFAULT_SPEAKER_NAMES } from "./speakers.js";

const sein = {
  title: "Sein in the present",
  topic: "The Perfekt with haben",
  summary: "Say who someone is with the present tense of sein.",
  speakerNames: { teacher: "Mira" },
  hook: { text: "Ich bin müde.", translation: "I am tired." },
  examples: [
    { text: "Du bist müde.", translation: "You are tired." },
    { text: "Sie ist müde.", translation: "She is tired." },
    { text: "Wir sind müde.", translation: "We are tired." },
  ],
  notice: "The ending changes with the person, and the verb stays the second idea.",
  rule: "Sein matches the person: ich bin, du bist, er ist, wir sind. The verb is the second idea in the sentence.",
  mnemonic: "bin, bist, ist, sind — the person picks the form.",
  exception: "There is no exception worth stopping for yet.",
  drills: [
    { kind: "sentence", cue: "How would you say She is tired?", answer: "Sie ist müde.", translation: "She is tired." },
    { kind: "word", cue: "Say it out loud.", answer: "Ich bin", translation: "I am." },
    { kind: "word", cue: "How would you say you are?", answer: "Du bist", translation: "you are." },
    { kind: "phrase", cue: "Try saying I am tired.", answer: "Ich bin müde.", translation: "I am tired." },
    { kind: "sentence", cue: "Now make it about us: Ich bin müde.", source: "Ich bin müde.", answer: "Wir sind müde.", translation: "We are tired." },
    { kind: "sentence", cue: "How would you say We are ready?", answer: "Wir sind bereit.", translation: "We are ready." },
  ],
  checks: [
    { cue: "What form goes with ich?", answer: "bin." },
    { cue: "Where does the verb go?", answer: "In second position." },
  ],
  recombinations: [
    { cue: "How would you say I am ready?", answer: "Ich bin bereit.", translation: "I am ready." },
    { cue: "Can you say You are tired today?", answer: "Du bist heute müde.", translation: "You are tired today." },
  ],
};

describe("grammar lessons", () => {
  it("walks a level's topics and skips ones this learner just studied", () => {
    expect(selectGrammarTopic({ language: "de-DE", level: "A1", recentTopics: [] }).title).toBe("Present tense of sein");
    expect(selectGrammarTopic({
      language: "de-DE",
      level: "A1",
      recentTopics: ["Present tense of sein"],
    }).title).toBe("Present tense of haben");
    expect(selectGrammarTopic({ language: "de-DE", level: "A1", recentTopics: [] }).title).not.toContain("Perfekt");
    expect(selectGrammarTopic({ language: "de-DE", level: "B1", recentTopics: [] }).title).toBe("Clauses with weil");
    expect(selectGrammarTopic({ language: "fr-FR", level: "A1", recentTopics: [] }).title).toBe("Be and have");
    const german = grammarTopics("de-DE", "A1");
    const oldest = selectGrammarTopic({
      language: "de-DE",
      level: "A1",
      recentTopics: [...german].reverse().map((topic) => topic.title),
    });
    expect(oldest.title).toBe(german[0]?.title);
    expect(grammarTopics("de-DE", "A2")[2]?.prerequisites).toContain("The Perfekt with haben");
  });

  it("is one teacher, with clear drills and a later recall of the first form", () => {
    const topic = selectGrammarTopic({ language: "de-DE", level: "A1", recentTopics: [] });
    const lesson = shapeGrammarLesson(sein, {
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "A1",
      topic,
      priorReviews: [{ text: "Danke.", translation: "Thanks." }],
    });
    expect(lesson).not.toBeNull();
    const parsed = GeneratedLessonSchema.parse(lesson);
    expect(parsed.topic).toBe("Present tense of sein");
    expect(parsed.ruleId).toBe("de-sein");
    expect(parsed.segments.length).toBeGreaterThanOrEqual(8);
    expect(parsed.segments.length).toBeLessThanOrEqual(120);
    expect(parsed.segments.every((segment) => segment.speaker === "teacher")).toBe(true);
    expect(parsed.segments.some((segment) => segment.text.includes("One common exception"))).toBe(false);
    expect(grammarPromptsAreClear(parsed.segments)).toBe(true);
    for (let index = 0; index < parsed.segments.length; index += 1) {
      const segment = parsed.segments[index]!;
      if (segment.pauseAfterMs) {
        expect(["notice", "practice", "review", "warmup", "recombine", "check"]).toContain(segment.phase);
        expect(parsed.segments[index + 1]?.pauseAfterMs).toBeUndefined();
      }
      expect(segment.text).not.toBe(parsed.segments[index + 1]?.text);
    }
    const forms = parsed.segments.map((segment, index) => segment.text === "Ich bin" ? index : -1).filter((index) => index >= 0);
    expect(forms.length).toBeGreaterThan(1);
    expect(forms[1]! - forms[0]!).toBeGreaterThan(2);
    const vague = parsed.segments.find((segment) => segment.text.includes("I am?"));
    expect(vague?.text).toContain("How would you say");
    expect(parsed.segments.some((segment) => segment.text.includes("Ich bin müde.") && segment.phase === "practice")).toBe(true);
    const remembered = phrasesToRemember(parsed.segments, DEFAULT_SPEAKER_NAMES, "de-DE");
    expect(remembered.map((phrase) => phrase.text)).toContain("Ich bin");
    expect(remembered.every((phrase) => phrase.speaker === "speakerA")).toBe(true);
    expect(remembered.some((phrase) => phrase.text.includes("second position"))).toBe(false);
  });
});
