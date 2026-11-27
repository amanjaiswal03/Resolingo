import { describe, expect, it } from "vitest";
import {
  offScriptLines,
  offScriptWords,
  pieceOfLine,
  targetVocabulary,
  withoutOffScriptLines,
  wordOnScript,
} from "./on-script.js";
import { shapePimsleurLesson } from "./pimsleur.js";
import type { LessonSegment } from "./schemas.js";

const de = (text: string) => `[[lang:de-DE]]${text}[[/lang]]`;

describe("on-script words", () => {
  const vocabulary = targetVocabulary([
    "Hallo, hast du kurz Zeit?",
    "Kann ich deine Bohrmaschine ausleihen?",
    "Ja, ich bringe sie morgen zurück.",
  ], "de-DE");

  it("accepts the lesson's words and their forms", () => {
    for (const word of ["Bohrmaschine", "kannst", "zurückbringen", "st", "Zeit", "ausleihen"]) {
      expect(wordOnScript(word, vocabulary), word).toBe(true);
    }
  });

  it("flags words the lesson never uses", () => {
    expect(wordOnScript("Kino", vocabulary)).toBe(false);
    expect(wordOnScript("Leiter", vocabulary)).toBe(false);
    expect(offScriptWords(`${de("Ich gehe heute ins Kino")} means I'm going to the cinema today.`, vocabulary))
      .toEqual(["gehe", "heute", "kino"]);
    expect(offScriptWords(`${de("kurz Zeit")} means a moment, and ${de("-st")} is the ending.`, vocabulary)).toEqual([]);
  });

  it("matches unspaced scripts on characters", () => {
    const ja = targetVocabulary(["駅はどこですか。"], "ja-JP");
    expect(offScriptWords("[[lang:ja-JP]]駅[[/lang]] is the station.", ja)).toEqual([]);
    expect(offScriptWords("[[lang:ja-JP]]映画館[[/lang]] is a cinema.", ja).length).toBeGreaterThan(0);
  });
});

describe("buildup pieces", () => {
  it("keeps only runs of words cut from the line", () => {
    expect(pieceOfLine("deine Bohrmaschine ausleihen", "Kann ich deine Bohrmaschine ausleihen?", "de-DE")).toBe(true);
    expect(pieceOfLine("ausleihen", "Kann ich deine Bohrmaschine ausleihen?", "de-DE")).toBe(true);
    expect(pieceOfLine("deine Leiter ausleihen", "Kann ich deine Bohrmaschine ausleihen?", "de-DE")).toBe(false);
    expect(pieceOfLine("ich ausleihen", "Kann ich deine Bohrmaschine ausleihen?", "de-DE")).toBe(false);
    expect(pieceOfLine("どこですか", "駅はどこですか。", "ja-JP")).toBe(true);
  });
});

describe("off-script lines in a finished lesson", () => {
  const segments: LessonSegment[] = [
    { id: "seg_01", kind: "dialogue", speaker: "speakerA", delivery: "warm", language: "de-DE", text: "Kann ich deine Bohrmaschine ausleihen?" },
    { id: "seg_02", kind: "explanation", speaker: "teacher", delivery: "warm", language: "en-US", text: `${de("ausleihen")} means to borrow.` },
    { id: "seg_03", kind: "explanation", speaker: "teacher", delivery: "warm", language: "en-US", text: `You could also say ${de("Ich gehe ins Kino")}.` },
    { id: "seg_04", kind: "drill", speaker: "teacher", delivery: "curious", language: "en-US", text: "How would you say can I borrow your drill?", pauseAfterMs: 6000 },
    { id: "seg_05", kind: "drill", speaker: "speakerA", delivery: "clear", language: "de-DE", text: "Kann ich deine Bohrmaschine ausleihen?" },
  ];

  it("drops a made-up note and keeps the rest", () => {
    const issues = offScriptLines(segments, "de-DE");
    expect(issues).toEqual([{ id: "seg_03", kind: "explanation", words: ["gehe", "kino"] }]);
    expect(withoutOffScriptLines(segments, issues)?.map((segment) => segment.id)).toEqual(["seg_01", "seg_02", "seg_04", "seg_05"]);
  });

  it("rejects a lesson whose drill prompt quotes made-up words", () => {
    const prompt = { ...segments[3]!, text: `Now say ${de("Ich habe einen Hund")}.` };
    const issues = offScriptLines([segments[0]!, prompt, segments[4]!], "de-DE");
    expect(issues.map((issue) => issue.id)).toEqual(["seg_04"]);
    expect(withoutOffScriptLines([segments[0]!, prompt, segments[4]!], issues)).toBeNull();
  });

  it("counts the material a lesson is built on, such as a grammar topic's forms", () => {
    const intro: LessonSegment = { id: "seg_09", kind: "narration", speaker: "teacher", delivery: "warm", language: "en-US", text: `Today: ${de("sein")}.` };
    const example: LessonSegment = { id: "seg_10", kind: "example", speaker: "teacher", delivery: "clear", language: "de-DE", text: "Ich bin müde." };
    expect(offScriptLines([intro, example], "de-DE")).toHaveLength(1);
    expect(offScriptLines([intro, example], "de-DE", ["Present tense of sein"])).toEqual([]);
  });
});

describe("conversation lessons stay on script", () => {
  const lines = [
    { speaker: "speakerA", text: "Hast du kurz Zeit?", translation: "Do you have a moment?", language: "de-DE" },
    { speaker: "speakerB", text: "Ja, klar. Was brauchst du?", translation: "Yes, sure. What do you need?", language: "de-DE" },
    { speaker: "speakerA", text: "Kann ich deine Bohrmaschine ausleihen?", translation: "Can I borrow your drill?", language: "de-DE" },
    { speaker: "speakerB", text: "Natürlich. Brauchst du sie heute?", translation: "Of course. Do you need it today?", language: "de-DE" },
  ];
  const lesson = (overrides: Record<string, unknown>) => shapePimsleurLesson({
    title: "Borrowing a drill",
    speakerNames: { teacher: "Mira", speakerA: "Jonas", speakerB: "Mia" },
    lines,
    phrases: lines.map((item) => ({ ...item })),
    cues: { welcome: "Today you borrow something from a neighbour.", closing: "You can now borrow something." },
    ...overrides,
  }, { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A2" })!;
  const texts = (value: ReturnType<typeof lesson>) => value.segments.map((segment) => segment.text).join("\n");

  it("never drills a buildup piece that is not part of its line", () => {
    const shaped = lesson({
      phrases: lines.map((item, index) => index === 2
        ? { ...item, chunks: [{ text: "deine Leiter ausleihen", translation: "borrow your ladder" }, { text: "ausleihen", translation: "to borrow" }] }
        : { ...item }),
    });
    expect(texts(shaped)).not.toContain("Leiter");
    expect(shaped.segments.some((segment) => segment.speaker !== "teacher" && segment.text === "ausleihen")).toBe(true);
  });

  it("drops notes, glosses, recall cues, and tips that bring in other words", () => {
    const shaped = lesson({
      phrases: lines.map((item, index) => index === 2
        ? {
          ...item,
          note: `Like ${de("Ich gehe ins Kino")}, this is a question.`,
          recallCue: `You are at the ${de("Bahnhof")}. Ask for the drill.`,
          chunks: [{ text: "ausleihen", translation: "to borrow", gloss: `${de("ausleihen")} is like ${de("mieten")}.` }],
        }
        : { ...item }),
      usageTip: `People also say ${de("Hast du einen Hund")}.`,
    });
    const all = texts(shaped);
    for (const word of ["Kino", "Bahnhof", "mieten", "Hund"]) expect(all, word).not.toContain(word);
    expect(offScriptLines(shaped.segments, "de-DE")).toEqual([]);
  });

  it("replaces a cue that quotes another topic with the standard cue", () => {
    const shaped = lesson({ cues: { welcome: "Welcome.", closing: `Next time, try ${de("Wo ist der Bahnhof")}.` } });
    expect(texts(shaped)).not.toContain("Bahnhof");
    expect(shaped.segments.at(-1)?.phase).toBe("closing");
  });
});
