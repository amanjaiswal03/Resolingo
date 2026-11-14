import { describe, expect, it } from "vitest";
import { GeneratedLessonSchema } from "./schemas.js";
import {
  ANSWER_PAUSE_MS,
  REVIEW_INTERVALS_MS,
  arrangePimsleur,
  backwardChunks,
  shapePimsleurLesson,
  type LessonCues,
} from "./pimsleur.js";

const names = { teacher: "Mira", speakerA: "Lukas", speakerB: "Anna" };
const cues: LessonCues = {
  welcome: "Welcome. Just listen.",
  listen: "Just listen.",
  afterDialogue: "You just heard the conversation.",
  buildup: "Let's build it up from the end.",
  howWouldYouSay: "How would you say",
  sayIt: "Say it out loud.",
  yourTurn: "Now you say it.",
  again: "Let's hear it once more.",
  closing: "Nice work.",
};

describe("backward buildup", () => {
  it("builds a phrase from the last word and a long word from the last syllable", () => {
    expect(backwardChunks("the train station")).toEqual(["station", "train station", "the train station"]);
    const word = backwardChunks("Bahnhof");
    expect(word.at(-1)).toBe("Bahnhof");
    expect(word.length).toBeGreaterThan(1);
    expect(word[0]?.length).toBeLessThan("Bahnhof".length);
    expect(backwardChunks("Hi")).toEqual(["Hi"]);
  });
});

describe("Pimsleur arrangement", () => {
  const lines = [
    { speaker: "speakerA" as const, text: "Wo ist der Bahnhof?", translation: "Where is the station?", language: "de-DE" as const },
    { speaker: "speakerB" as const, text: "Geradeaus.", translation: "Straight ahead.", language: "de-DE" as const },
    { speaker: "speakerA" as const, text: "Danke.", translation: "Thanks.", language: "de-DE" as const },
    { speaker: "speakerB" as const, text: "Bitte.", translation: "You're welcome.", language: "de-DE" as const },
  ];
  const phrases = [
    { ...lines[0]!, note: "This asks for the station." },
    { ...lines[1]!, note: "This means straight ahead." },
  ];

  it("opens with the dialogue, drills with a five second pause, and repeats the dialogue", () => {
    const segments = arrangePimsleur({
      lines,
      phrases,
      cues,
      names,
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      estimateMs: () => 10_000,
    });
    expect(segments[0]).toMatchObject({ speaker: "teacher", phase: "intro", language: "en-US" });
    const opening = segments.filter((segment) => segment.phase === "dialogue").map((segment) => segment.text);
    const closing = segments.filter((segment) => segment.phase === "closing" && segment.speaker !== "teacher").map((segment) => segment.text);
    expect(opening).toEqual(lines.map((line) => line.text));
    expect(closing).toEqual(opening);
    const prompt = segments.find((segment) => segment.text.startsWith("How would you say Where is the station"));
    expect(prompt?.pauseAfterMs).toBe(ANSWER_PAUSE_MS);
    expect(prompt?.speaker).toBe("teacher");
    expect(prompt?.text).toContain("Say it out loud.");
    const answer = segments[segments.indexOf(prompt!) + 1];
    expect(answer).toMatchObject({ speaker: "speakerA", text: "Wo ist der Bahnhof?" });
    expect(answer?.pauseAfterMs).toBeUndefined();
    expect(segments.some((segment) => segment.text === "Bahnhof?" || segment.text.endsWith("Bahnhof?"))).toBe(true);
    const answers = lines.map((line) => segments.find((segment) => segment.phase === "answer" && segment.text === line.text));
    expect(answers.every(Boolean)).toBe(true);
    const pauses = segments.filter((segment) => segment.pauseAfterMs);
    expect(pauses.length).toBeGreaterThan(0);
    expect(pauses.every((segment) => segment.speaker === "teacher" && segment.language === "en-US")).toBe(true);
    expect(pauses.every((segment) => /say it out loud|now you say it/i.test(segment.text))).toBe(true);
    expect(segments.filter((segment) => segment.phase === "answer").every((segment) => segment.pauseAfterMs === undefined)).toBe(true);
    expect(segments.length).toBeGreaterThan(16);
    expect(segments.length).toBeLessThanOrEqual(96);
    expect(GeneratedLessonSchema.safeParse({
      title: "At the station",
      topic: "Asking for the station",
      summary: "A short station conversation.",
      speakerNames: names,
      segments,
    }).success).toBe(true);
  });

  it("returns the first phrase after other material, on the 25 second interval", () => {
    const segments = arrangePimsleur({
      lines,
      phrases,
      cues,
      names,
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      estimateMs: () => 10_000,
    });
    const answers = segments.filter((segment) => segment.phase === "answer" && segment.text === "Wo ist der Bahnhof?");
    expect(answers.length).toBeGreaterThan(1);
    const first = segments.indexOf(answers[0]!);
    const second = segments.indexOf(answers[1]!);
    expect(second - first).toBeGreaterThan(1);
    const between = segments.slice(first + 1, second);
    expect(between.some((segment) => segment.text.includes("Straight ahead") || segment.text === "Geradeaus.")).toBe(true);
    expect(REVIEW_INTERVALS_MS[0]).toBe(25_000);
  });
});

describe("model shaping", () => {
  it("expands a compact lesson and also an older segments payload", () => {
    const compact = shapePimsleurLesson({
      title: "At the station",
      topic: "Asking the way",
      summary: "Ask where the station is.",
      cues: { howWouldYouSay: "Wie sagt man?", welcome: 12, extra: "ignored" },
      lines: [
        { speaker: "Lukas", text: "Wo ist der Bahnhof?", translation: "Where is the station?", language: "fr-FR" },
        { speaker: "speakerB", text: "Geradeaus.", translation: "Straight ahead." },
      ],
      phrases: [
        { speaker: "speakerA", text: "Wo ist der Bahnhof?", translation: "Where is the station?", note: "A useful question." },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE" });
    expect(compact?.segments[0]?.text).toContain("Welcome");
    expect(compact?.segments.some((segment) => segment.text.startsWith("Wie sagt man"))).toBe(true);
    expect(compact?.segments.find((segment) => segment.text === "Wo ist der Bahnhof?")?.language).toBe("de-DE");

    const legacy = shapePimsleurLesson({
      title: "Coffee shop greetings",
      segments: [
        { speaker: "teacher", text: "Ignore this teacher line." },
        { speaker: "speakerA", language: "de-DE", text: "Einen Kaffee, bitte.", translation: "A coffee, please." },
        { speaker: "speakerB", language: "de-DE", text: "Gerne.", translation: "Of course." },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE" });
    expect(legacy?.segments.filter((segment) => segment.phase === "dialogue").map((segment) => segment.text)).toEqual([
      "Einen Kaffee, bitte.",
      "Gerne.",
    ]);
    expect(legacy?.speakerNames.speakerB).toBe("Anna");
  });

  it("drills every turn when the model only names some phrases", () => {
    const four = [
      { speaker: "speakerA", text: "Guten Morgen.", translation: "Good morning.", language: "de-DE" },
      { speaker: "speakerB", text: "Guten Morgen.", translation: "Good morning to you.", language: "de-DE" },
      { speaker: "speakerA", text: "Wie geht's?", translation: "How are you?", language: "de-DE" },
      { speaker: "speakerB", text: "Gut, danke.", translation: "Fine, thanks.", language: "de-DE" },
    ];
    const shaped = shapePimsleurLesson({
      title: "Morning",
      topic: "Greeting",
      summary: "A morning greeting.",
      lines: four,
      phrases: [
        { speaker: "speakerA", text: "Guten Morgen.", translation: "Good morning." },
        { speaker: "speakerB", text: "Gut, danke.", translation: "Fine, thanks." },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE" });
    const segments = shaped?.segments ?? [];
    for (const line of four) {
      expect(segments.some((segment) => segment.phase === "answer" && segment.text === line.text && segment.speaker === line.speaker)).toBe(true);
    }
    const closing = segments.filter((segment) => segment.phase === "closing" && segment.speaker !== "teacher").map((segment) => segment.text);
    expect(closing).toEqual(four.map((line) => line.text));
    const pauses = segments.filter((segment) => segment.pauseAfterMs);
    expect(pauses.every((segment) => segment.speaker === "teacher")).toBe(true);
    expect(pauses.every((segment) => /say it out loud|now you say it/i.test(segment.text))).toBe(true);
    expect(GeneratedLessonSchema.safeParse({
      title: "Morning",
      topic: "Greeting",
      summary: "A morning greeting.",
      speakerNames: shaped?.speakerNames,
      segments,
    }).success).toBe(true);
  });
});
