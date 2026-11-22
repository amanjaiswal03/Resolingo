import { describe, expect, it } from "vitest";
import { GeneratedLessonSchema } from "./schemas.js";
import { speakingPauseMs } from "./speaking-timing.js";
import {
  MAX_PIMSLEUR_SEGMENTS,
  REVIEW_GAPS,
  arrangePimsleur,
  backwardChunks,
  buildupChunks,
  drillsAreUnique,
  priorReviewsAreIntroduced,
  shapePimsleurLesson,
  recallPromptsCiteMeanings,
  scheduleReviewSlots,
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
    expect(backwardChunks("駅はどこですか。", "ja-JP")).toEqual(["どこですか", "駅はどこですか"]);
    expect(backwardChunks("火車站在哪裡？", "zh-TW")).toEqual(["哪裡", "在哪裡", "火車站在哪裡"]);
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

  it("opens with the dialogue, models each answer, and gives longer answers more time", () => {
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
    const prompt = segments.find((segment) => segment.pauseAfterMs && segment.phase === "recall");
    expect(prompt?.speaker).toBe("teacher");
    expect(prompt?.language).toBe("en-US");
    const answer = segments[segments.indexOf(prompt!) + 1];
    expect(answer).toMatchObject({ speaker: "speakerA", text: "Wo ist der Bahnhof?" });
    expect(prompt?.pauseAfterMs).toBeGreaterThan(segments.find((segment, index) => (
      segment.pauseAfterMs && segments[index + 1]?.text === "Danke."
    ))?.pauseAfterMs ?? Infinity);
    expect(answer?.pauseAfterMs).toBeUndefined();
    expect(segments.some((segment) => segment.phase === "buildup" && segment.language === "de-DE")).toBe(false);
    expect(drillsAreUnique(segments)).toBe(true);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
    expect(recallPromptsCiteMeanings(segments)).toBe(true);
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
    expect(segments.length).toBeLessThanOrEqual(MAX_PIMSLEUR_SEGMENTS);
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
    const answers = segments.filter((segment) => (segment.phase === "answer" || segment.phase === "review") && segment.text === "Wo ist der Bahnhof?");
    expect(answers.length).toBeGreaterThan(1);
    const first = segments.indexOf(answers[0]!);
    const second = segments.indexOf(answers[1]!);
    expect(second - first).toBeGreaterThan(1);
    const between = segments.slice(first + 1, second);
    expect(between.some((segment) => segment.text.includes("Straight ahead") || segment.text === "Geradeaus.")).toBe(true);
    expect(REVIEW_GAPS).toEqual([1, 3, 6]);
  });
});

describe("recall prompts", () => {
  const line = (text: string, extra: Partial<import("./schemas.js").LessonSegment> = {}) => ({
    id: text,
    kind: "drill" as const,
    speaker: "speakerA" as const,
    delivery: "clear" as const,
    language: "de-DE" as const,
    text,
    ...extra,
  });

  it("requires the answer's meaning unless that exact line was just heard", () => {
    const missing = [
      line("How would you ask for that?", { speaker: "teacher", language: "en-US", phase: "recall", pauseAfterMs: 5000 }),
      line("Wo ist der Bahnhof?", { phase: "answer", translation: "Where is the station?" }),
    ];
    expect(recallPromptsCiteMeanings(missing)).toBe(false);
    const echoed = [
      line("Wo ist der Bahnhof?"),
      line("Say it out loud.", { speaker: "teacher", language: "en-US", phase: "recall", pauseAfterMs: 5000 }),
      line("Wo ist der Bahnhof?", { phase: "answer", translation: "Where is the station?" }),
    ];
    expect(recallPromptsCiteMeanings(echoed)).toBe(true);
    const cited = [
      line("How would you say Where is the station?", { speaker: "teacher", language: "en-US", phase: "review", pauseAfterMs: 5000 }),
      line("Wo ist der Bahnhof?", { phase: "review", translation: "Where is the station?" }),
    ];
    expect(recallPromptsCiteMeanings(cited)).toBe(true);
  });
});

describe("review scheduler", () => {
  it("spaces recalls after 1, 3, and 6 other items and keeps them apart", () => {
    const slots = scheduleReviewSlots(4, 12);
    const first = slots.filter((slot) => slot.item === 0).map((slot) => slot.gap);
    expect(first[0]).toBe(1);
    expect(first).toContain(3);
    const placed = slots.filter((slot) => slot.afterItem < 4);
    expect(placed.map((slot) => slot.afterItem)).toEqual([1, 2, 3]);
    expect(new Set(placed.map((slot) => slot.item)).size).toBeGreaterThan(1);
    const ends = new Map<number, number>();
    for (const slot of placed) ends.set(slot.afterItem, (ends.get(slot.afterItem) ?? 0) + 1);
    expect([...ends.values()].every((count) => count === 1)).toBe(true);
  });

  it("keeps the nearest gaps when the cap is small", () => {
    const slots = scheduleReviewSlots(4, 2);
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.gap === 1)).toBe(true);
    expect(scheduleReviewSlots(3, 0)).toEqual([]);
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
            { text: "Anna!", gloss: "This one is obvious and should still be optional." },
          ],
        },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE" });
    const segments = shaped?.segments ?? [];
    const pauses = segments.filter((segment) => segment.pauseAfterMs);
    expect(pauses.every((segment) => segment.speaker === "teacher" && segment.kind === "drill")).toBe(true);
    expect(pauses.some((segment) => /^(Can you say|Try saying|How would you say) Where is the station[.?]$/.test(segment.text))).toBe(true);
    for (let index = 1; index < pauses.length; index += 1) {
      expect(pauses[index]?.text.toLocaleLowerCase()).not.toBe(pauses[index - 1]?.text.toLocaleLowerCase());
    }
    const gloss = segments.find((segment) => segment.kind === "explanation" && segment.phase === "buildup");
    expect(gloss?.text).toContain("[[lang:de-DE]]Bahnhof[[/lang]]");
    expect(gloss?.text.toLowerCase()).toContain("means");
    expect(gloss).toMatchObject({ speaker: "teacher", language: "en-US" });
    expect(gloss?.pauseAfterMs).toBeUndefined();
    const glossAt = segments.indexOf(gloss!);
    expect(segments[glossAt - 1]?.text).not.toBe("Bahnhof");
    expect(segments[glossAt + 1]).toMatchObject({ kind: "example", text: "Bahnhof", speaker: "speakerA" });
    expect(segments.filter((segment) => segment.phase === "buildup" && segment.pauseAfterMs)).toHaveLength(0);
    expect(segments.some((segment) => segment.text === "Anna" || segment.text === "Anna!")).toBe(false);
    expect(segments.filter((segment) => segment.kind === "explanation").every((segment) => segment.pauseAfterMs === undefined)).toBe(true);
    expect(segments.some((segment) => segment.text.includes("obvious"))).toBe(false);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
  });

  it("explains and models the chunks, then invites a single echo", () => {
    const shaped = shapePimsleurLesson({
      title: "Asking the way",
      topic: "The station",
      summary: "Ask where the train station is.",
      cues: {
        echo: ["Try the word on its own.", "Copy the rhythm you just heard."],
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
    expect(pairs.map((pair) => pair.answer)).toEqual(["der Bahnhof"]);
    expect(["Try the word on its own.", "Copy the rhythm you just heard."]).toContain(pairs[0]?.prompt);
    expect(segments.filter((segment) => segment.phase === "buildup" && segment.kind === "example").map((segment) => segment.text))
      .toEqual(["Bahnhof", "der Bahnhof", "ist der Bahnhof"]);
    const whole = segments.find((segment) => segment.phase === "recall" && segment.pauseAfterMs);
    expect(whole?.text).toContain("Excuse me, where is the train station");
    expect(segments[segments.indexOf(whole!) + 1]?.text).toBe("Entschuldigung, wo ist der Bahnhof?");
    const gloss = segments.find((segment) => segment.kind === "explanation" && segment.phase === "buildup" && segment.text.includes("der Bahnhof"));
    expect(gloss?.text).toContain("[[lang:de-DE]]der Bahnhof[[/lang]]");
    expect(gloss?.text.toLowerCase()).toMatch(/means|is how you say/);
    expect(gloss?.text.trim()).not.toBe("the train station");
    expect(gloss?.pauseAfterMs).toBeUndefined();
    const glossAt = segments.indexOf(gloss!);
    expect(segments[glossAt - 1]?.text).not.toBe("der Bahnhof");
    expect(segments[glossAt + 1]).toMatchObject({ kind: "example", text: "der Bahnhof" });
    expect(segments[glossAt + 2]?.pauseAfterMs).toBeGreaterThan(0);
    expect(segments[glossAt + 3]).toMatchObject({ kind: "drill", text: "der Bahnhof" });
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
    expect(barePairs).toHaveLength(0);
    expect(bare?.segments).toContainEqual(expect.objectContaining({ kind: "example", text: "der Bahnhof" }));
  });

  it("varies the breakdown, drops a name, and plays each chunk once", () => {
    const shaped = shapePimsleurLesson({
      title: "At the station",
      topic: "Asking the way",
      summary: "Ask where the station is.",
      lines: [
        { speaker: "speakerA", text: "Anna, wo ist der Bahnhof?", translation: "Anna, where is the station?", language: "de-DE" },
        { speaker: "speakerB", text: "Geradeaus.", translation: "Straight ahead.", language: "de-DE" },
        { speaker: "speakerA", text: "Anna!", translation: "Anna!", language: "de-DE" },
        { speaker: "speakerB", text: "Bitte.", translation: "You're welcome.", language: "de-DE" },
      ],
      phrases: [
        {
          speaker: "speakerA",
          text: "Anna, wo ist der Bahnhof?",
          translation: "Anna, where is the station?",
          chunks: [
            { text: "der Bahnhof", translation: "the station", gloss: "the station" },
            { text: "wo ist", translation: "where is" },
            { text: "Anna!", translation: "Anna" },
          ],
        },
        { speaker: "speakerB", text: "Geradeaus.", translation: "Straight ahead.", chunks: [] },
        { speaker: "speakerA", text: "Anna!", translation: "Anna!" },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE" });
    const segments = shaped?.segments ?? [];
    const script = segments
      .filter((segment) => segment.phase === "buildup" || segment.phase === "answer")
      .map((segment) => `${segment.speaker}: ${segment.text}${segment.pauseAfterMs ? " [pause]" : ""}`);
    expect(script).toContain("speakerA: der Bahnhof");
    expect(segments.filter((segment) => segment.kind === "example" && segment.text === "der Bahnhof")).toHaveLength(1);
    expect(script).toContain("speakerA: wo ist");
    expect(script.some((line) => line.includes("Anna"))).toBe(false);
    expect(segments.some((segment) => segment.phase === "buildup" && segment.text === "Geradeaus.")).toBe(false);
    expect(segments.some((segment) => segment.phase === "answer" && segment.text === "wo ist der Bahnhof?")).toBe(true);
    expect(segments.some((segment) => segment.phase === "dialogue" && segment.text === "Anna!")).toBe(true);
    expect(segments.some((segment) => segment.phase === "answer" && segment.text === "Anna!")).toBe(false);
    const stationPrompt = segments.find((segment) => segment.pauseAfterMs && segments[segments.indexOf(segment) + 1]?.text === "der Bahnhof");
    expect(segments[segments.indexOf(stationPrompt!) - 1]).toMatchObject({ kind: "example", text: "der Bahnhof" });
    expect(drillsAreUnique(segments)).toBe(true);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
    expect(segments.length).toBeLessThanOrEqual(MAX_PIMSLEUR_SEGMENTS);
  });

  it("uses a listening-only breakdown and a situation-specific cue on the next line", () => {
    const first = { speaker: "speakerA", text: "Wo ist der Bahnhof?", translation: "Where is the station?" };
    const second = { speaker: "speakerB", text: "Gehen Sie geradeaus.", translation: "Go straight ahead." };
    const recallCue = "They're waiting for directions. Tell them: Go straight ahead.";
    const segments = shapePimsleurLesson({
      title: "Walking to the station",
      lines: [first, second],
      phrases: [
        { ...first, chunks: [{ text: "der Bahnhof", translation: "the station" }] },
        { ...second, recallCue, chunks: [{ text: "geradeaus", translation: "straight ahead" }] },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE" })!.segments;
    expect(segments.filter((segment) => segment.phase === "buildup" && segment.kind === "narration")).toHaveLength(1);
    const model = segments.findIndex((segment) => segment.phase === "buildup" && segment.text === "geradeaus");
    expect(segments[model]).toMatchObject({ kind: "example" });
    expect(segments[model + 1]).toMatchObject({ kind: "example", text: second.text });
    expect(segments[model + 2]).toMatchObject({ kind: "drill", text: recallCue });
    expect(segments[model + 3]).toMatchObject({ kind: "drill", text: second.text });
  });

  it("recalls earlier lines, recombines them, and warms up with a due phrase", () => {
    const shaped = shapePimsleurLesson({
      title: "At the station",
      topic: "Asking the way",
      summary: "Ask where the station is.",
      lines: [
        { speaker: "speakerA", text: "Wo ist der Bahnhof?", translation: "Where is the station?", language: "de-DE" },
        { speaker: "speakerB", text: "Geradeaus.", translation: "Straight ahead.", language: "de-DE" },
        { speaker: "speakerA", text: "Danke.", translation: "Thanks.", language: "de-DE" },
        { speaker: "speakerB", text: "Bitte.", translation: "You're welcome.", language: "de-DE" },
      ],
      recombinations: [{ speaker: "speakerA", text: "Wo ist das Hotel?", translation: "Where is the hotel?" }],
      roleplay: { stimulus: "Wo ist der Bahnhof?", text: "Geradeaus.", translation: "Straight ahead." },
    }, {
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      priorReviews: [
        { speaker: "speakerA", text: "Einen Kaffee, bitte.", translation: "A coffee, please.", language: "de-DE" },
        { speaker: "speakerA", text: "Die Rechnung, bitte.", translation: "The bill, please.", language: "de-DE" },
        { speaker: "speakerB", text: "Wo ist die Toilette?", translation: "Where is the toilet?", language: "de-DE" },
      ],
    });
    const segments = shaped?.segments ?? [];
    const priorTexts = ["Einen Kaffee, bitte.", "Die Rechnung, bitte.", "Wo ist die Toilette?"];
    const warmup = segments.findIndex((segment) => segment.phase === "warmup" && segment.pauseAfterMs);
    expect(segments.slice(0, warmup).some((segment) => /remember|recall|earlier|last time/i.test(segment.text))).toBe(true);
    expect(segments[warmup - 1]).toMatchObject({ kind: "example", text: "Einen Kaffee, bitte." });
    expect(segments[warmup]?.text.toLowerCase()).toContain("a coffee, please");
    expect(segments[warmup + 1]).toMatchObject({ text: "Einen Kaffee, bitte.", phase: "warmup" });
    expect(segments[warmup + 1]?.speaker).not.toBe("teacher");
    const dialogueAt = segments.findIndex((segment) => segment.phase === "dialogue");
    expect(warmup).toBeLessThan(dialogueAt);
    expect(segments.slice(warmup, dialogueAt).some((segment) => /today's conversation/i.test(segment.text))).toBe(true);
    const mixed = segments.findIndex((segment) => segment.kind === "drill" && segment.text === "Wo ist die Toilette?");
    expect(mixed).toBeGreaterThan(dialogueAt);
    expect(segments[mixed - 1]?.text).toMatch(/previous lesson|earlier lesson/i);
    expect(segments[mixed - 1]?.text.toLowerCase()).toContain("where is the toilet");
    expect(priorReviewsAreIntroduced(segments, priorTexts)).toBe(true);
    const introductions = segments
      .filter((segment) => segment.speaker === "teacher" && /remember|recall|previous lesson|earlier lesson|today's conversation/i.test(segment.text))
      .map((segment) => segment.text.trim().toLocaleLowerCase());
    expect(new Set(introductions).size).toBe(introductions.length);
    const first = segments.findIndex((segment) => segment.phase === "answer" && segment.text === "Wo ist der Bahnhof?");
    const again = segments.findIndex((segment, index) => index > first && segment.phase === "review" && segment.text === "Wo ist der Bahnhof?");
    expect(again).toBeGreaterThan(first);
    expect(segments.slice(first + 1, again).some((segment) => segment.text === "Geradeaus.")).toBe(true);
    const fresh = segments.findIndex((segment) => segment.kind === "drill" && segment.text === "Wo ist das Hotel?");
    expect(segments[fresh - 1]?.pauseAfterMs).toBeGreaterThan(0);
    expect(segments[fresh - 1]?.text.toLowerCase()).toContain("where is the hotel");
    expect(segments[fresh - 2]).toMatchObject({ kind: "example", text: "Wo ist das Hotel?" });
    expect(segments[fresh - 3]).toMatchObject({ kind: "explanation", speaker: "teacher" });
    const role = segments.findIndex((segment) => segment.phase === "roleplay" && segment.text === "Geradeaus.");
    expect(segments[role - 1]?.text).toBe("Lukas asks you: Where is the station. Tell him: Straight ahead.");
    expect(segments[role - 1]?.pauseAfterMs).toBeGreaterThan(0);
    expect(segments[role - 2]?.text).toBe("Wo ist der Bahnhof?");
    expect(segments[role]).toMatchObject({ speaker: "speakerB", text: "Geradeaus." });
    expect(segments[role]?.text).not.toBe(segments[role - 2]?.text);
    const recalls = segments.filter((segment) => segment.phase === "review" && segment.pauseAfterMs);
    expect(recalls.length).toBeGreaterThan(0);
    expect(recalls.every((segment) => {
      const answer = segments[segments.indexOf(segment) + 1];
      return answer?.translation && segment.text.toLowerCase().includes(answer.translation.replace(/[.!?？。]+$/u, "").trim().toLowerCase());
    })).toBe(true);
    expect(recallPromptsCiteMeanings(segments)).toBe(true);
    expect(drillsAreUnique(segments)).toBe(true);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
    for (const [index, prompt] of segments.entries()) {
      if (!prompt.pauseAfterMs) continue;
      const answer = segments[index + 1]!;
      expect(prompt.speaker).toBe("teacher");
      expect(prompt.pauseAfterMs).toBe(speakingPauseMs(answer.text, answer.language));
      expect(segments.slice(0, index)).toContainEqual(expect.objectContaining({
        kind: "example", text: answer.text, language: answer.language,
      }));
    }
  });
});
