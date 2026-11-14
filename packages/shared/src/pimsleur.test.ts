import { describe, expect, it } from "vitest";
import { GeneratedLessonSchema } from "./schemas.js";
import {
  ANSWER_PAUSE_MS,
  REVIEW_INTERVALS_MS,
  arrangePimsleur,
  backwardChunks,
  buildupChunks,
  shapePimsleurLesson,
  speakPromptsMatchAnswers,
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
    expect(buildupChunks("Wo ist der Bahnhof?")).toEqual(["Bahnhof", "der Bahnhof", "Wo ist der Bahnhof?"]);
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
    const prompt = segments.find((segment) => segment.pauseAfterMs === ANSWER_PAUSE_MS && segment.phase === "recall");
    expect(prompt?.speaker).toBe("teacher");
    expect(prompt?.language).toBe("en-US");
    const answer = segments[segments.indexOf(prompt!) + 1];
    expect(answer).toMatchObject({ speaker: "speakerA", text: "Wo ist der Bahnhof?" });
    expect(answer?.pauseAfterMs).toBeUndefined();
    expect(segments.some((segment) => segment.text === "Bahnhof")).toBe(true);
    expect(segments.some((segment) => segment.text === "der Bahnhof")).toBe(true);
    expect(segments.some((segment) => segment.text === "Bahnhof?" || segment.text === "der Bahnhof?")).toBe(false);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
    const answers = lines.map((line) => segments.find((segment) => segment.phase === "answer" && segment.text === line.text));
    expect(answers.every(Boolean)).toBe(true);
    const pauses = segments.filter((segment) => segment.pauseAfterMs);
    expect(pauses.length).toBeGreaterThan(1);
    expect(pauses.every((segment) => segment.speaker === "teacher" && segment.language === "en-US" && segment.kind === "drill")).toBe(true);
    expect(new Set(pauses.map((segment) => segment.text)).size).toBeGreaterThan(1);
    for (let index = 1; index < pauses.length; index += 1) {
      expect(pauses[index]?.text.toLocaleLowerCase()).not.toBe(pauses[index - 1]?.text.toLocaleLowerCase());
    }
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
    const custom = arrangePimsleur({
      lines: [
        { speaker: "speakerA", text: "Wo ist der Bahnhof?", translation: "Where is the station?", language: "de-DE" },
        { speaker: "speakerB", text: "Geradeaus.", translation: "Straight ahead.", language: "de-DE" },
      ],
      phrases: [{ speaker: "speakerA", text: "Wo ist der Bahnhof?", translation: "Where is the station?", language: "de-DE" }],
      cues: { ...cues, howWouldYouSay: "Wie sagt man" },
      names,
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      seed: 0,
      estimateMs: () => 10_000,
    });
    expect(custom.some((segment) => segment.pauseAfterMs && segment.text.startsWith("Wie sagt man"))).toBe(true);
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
    expect(pauses.every((segment) => segment.speaker === "teacher" && segment.kind === "drill")).toBe(true);
    expect(new Set(pauses.map((segment) => segment.text)).size).toBeGreaterThan(1);
    for (let index = 1; index < pauses.length; index += 1) {
      expect(pauses[index]?.text.toLocaleLowerCase()).not.toBe(pauses[index - 1]?.text.toLocaleLowerCase());
    }
    expect(GeneratedLessonSchema.safeParse({
      title: "Morning",
      topic: "Greeting",
      summary: "A morning greeting.",
      speakerNames: shaped?.speakerNames,
      segments,
    }).success).toBe(true);
  });

  it("uses the model's speak lines, and a gloss only on the matching chunk", () => {
    const shaped = shapePimsleurLesson({
      title: "At the station",
      topic: "Asking the way",
      summary: "Ask where the station is.",
      cues: {
        speak: [
          "Can you say {translation}?",
          "Try saying {translation}.",
          "How would you say {translation}?",
          "Your turn.",
          "Give it a try.",
          "Imagine you want to tell {name} — what would you say?",
          "Repeat after me.",
          "How would you ask for that?",
        ],
      },
      lines: [
        { speaker: "speakerA", text: "Wo ist der Bahnhof?", translation: "Where is the station?", language: "de-DE" },
        { speaker: "speakerB", text: "Geradeaus.", translation: "Straight ahead.", language: "de-DE" },
      ],
      phrases: [
        {
          speaker: "speakerA",
          text: "Wo ist der Bahnhof?",
          translation: "Where is the station?",
          chunks: [
            { text: "Bahnhof", gloss: "Bahnhof means the station." },
            { text: "ist", gloss: "This one is obvious and should still be optional." },
          ],
        },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE" });
    const segments = shaped?.segments ?? [];
    const pauses = segments.filter((segment) => segment.pauseAfterMs);
    const allowed = new Set([
      "Can you say Where is the station?",
      "Can you say Straight ahead?",
      "Try saying Where is the station.",
      "Try saying Straight ahead.",
      "How would you say Where is the station?",
      "How would you say Straight ahead?",
      "Your turn.",
      "Give it a try.",
      "Imagine you want to tell Anna — what would you say?",
      "Imagine you want to tell Lukas — what would you say?",
      "Repeat after me.",
      "Now you try.",
      "How would you ask for that?",
    ]);
    expect(pauses.every((segment) => segment.speaker === "teacher" && segment.kind === "drill")).toBe(true);
    expect(pauses.every((segment) => allowed.has(segment.text))).toBe(true);
    const partial = pauses.filter((segment) => {
      const answer = segments[segments.indexOf(segment) + 1];
      return answer?.text === "Bahnhof" || answer?.text === "der Bahnhof";
    });
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.every((segment) => !segment.text.includes("Where is the station"))).toBe(true);
    for (let index = 1; index < pauses.length; index += 1) {
      expect(pauses[index]?.text.toLocaleLowerCase()).not.toBe(pauses[index - 1]?.text.toLocaleLowerCase());
    }
    const gloss = segments.find((segment) => segment.kind === "explanation" && segment.phase === "buildup");
    expect(gloss?.text).toContain("[[lang:de-DE]]Bahnhof[[/lang]]");
    expect(gloss?.text.toLowerCase()).toContain("means");
    expect(gloss).toMatchObject({ speaker: "teacher", language: "en-US" });
    expect(gloss?.pauseAfterMs).toBeUndefined();
    const glossAt = segments.indexOf(gloss!);
    expect(segments[glossAt - 1]?.text).toBe("Bahnhof");
    expect(segments[glossAt + 1]?.pauseAfterMs).toBeGreaterThan(0);
    expect(segments[glossAt + 1]?.speaker).toBe("teacher");
    expect(segments[glossAt + 2]?.text).toBe("Bahnhof");
    expect(segments.filter((segment) => segment.kind === "explanation").every((segment) => segment.pauseAfterMs === undefined)).toBe(true);
    expect(segments.some((segment) => segment.text.includes("obvious"))).toBe(false);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
  });

  it("uses each chunk's translation, and a gloss that names the target", () => {
    const shaped = shapePimsleurLesson({
      title: "Asking the way",
      topic: "The station",
      summary: "Ask where the train station is.",
      cues: {
        speak: [
          "Can you say {translation}?",
          "Try saying {translation}.",
          "How would you say {translation}?",
          "Repeat after me.",
          "Now you try.",
          "Your turn.",
        ],
      },
      lines: [
        {
          speaker: "speakerA",
          text: "Entschuldigung, wo ist der Bahnhof?",
          translation: "Excuse me, where is the train station?",
          language: "de-DE",
        },
      ],
      phrases: [
        {
          speaker: "speakerA",
          text: "Entschuldigung, wo ist der Bahnhof?",
          translation: "Excuse me, where is the train station?",
          chunks: [
            { text: "Bahnhof", translation: "train station" },
            { text: "der Bahnhof", translation: "the train station", gloss: "the train station" },
            { text: "ist der Bahnhof" },
          ],
        },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE" });
    const segments = shaped?.segments ?? [];
    const pairs = segments.flatMap((segment, index) => {
      if (segment.phase !== "buildup" || !segment.pauseAfterMs) return [];
      const answer = segments[index + 1];
      return answer ? [{ prompt: segment.text, answer: answer.text }] : [];
    });
    expect(pairs.map((pair) => pair.answer)).toEqual([
      "Bahnhof",
      "der Bahnhof",
      "Entschuldigung, wo ist der Bahnhof?",
    ]);
    const station = pairs.find((pair) => pair.answer === "der Bahnhof");
    expect(station?.prompt.toLowerCase()).toContain("the train station");
    expect(station?.prompt).not.toContain("Excuse me");
    expect(station?.answer).toBe("der Bahnhof");
    const missing = pairs.find((pair) => pair.answer === "Bahnhof");
    expect(missing?.prompt.toLowerCase()).toContain("train station");
    expect(missing?.prompt).not.toContain("Excuse me");
    expect(missing?.prompt).not.toContain("the train station");
    const whole = pairs.find((pair) => pair.answer === "Entschuldigung, wo ist der Bahnhof?");
    expect(whole?.prompt).toContain("Excuse me, where is the train station");
    const gloss = segments.find((segment) => segment.kind === "explanation" && segment.phase === "buildup");
    expect(gloss?.text).toContain("[[lang:de-DE]]der Bahnhof[[/lang]]");
    expect(gloss?.text.toLowerCase()).toMatch(/means|is how you say/);
    expect(gloss?.text.trim()).not.toBe("the train station");
    expect(gloss?.pauseAfterMs).toBeUndefined();
    const glossAt = segments.indexOf(gloss!);
    expect(segments[glossAt - 1]?.text).toBe("der Bahnhof");
    expect(segments[glossAt + 1]?.text.toLowerCase()).toContain("the train station");
    expect(segments[glossAt + 1]?.pauseAfterMs).toBeGreaterThan(0);
    expect(segments[glossAt + 2]?.text).toBe("der Bahnhof");
    expect(speakPromptsMatchAnswers(segments)).toBe(true);

    const bare = shapePimsleurLesson({
      title: "Asking again",
      topic: "The station",
      summary: "Ask where the train station is.",
      lines: [
        {
          speaker: "speakerA",
          text: "Entschuldigung, wo ist der Bahnhof?",
          translation: "Excuse me, where is the train station?",
          language: "de-DE",
        },
      ],
      phrases: [
        {
          speaker: "speakerA",
          text: "Entschuldigung, wo ist der Bahnhof?",
          translation: "Excuse me, where is the train station?",
          chunks: [{ text: "der Bahnhof", gloss: "the train station" }],
        },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE" });
    const barePairs = (bare?.segments ?? []).flatMap((segment, index) => {
      if (!segment.pauseAfterMs) return [];
      const answer = bare?.segments[index + 1];
      return answer?.text === "der Bahnhof" ? [segment.text] : [];
    });
    expect(barePairs.length).toBeGreaterThan(0);
    expect(barePairs.every((prompt) => !prompt.includes("Excuse me") && !/train station/i.test(prompt))).toBe(true);
    expect(barePairs.every((prompt) => !prompt.includes("{translation}"))).toBe(true);
  });
});
