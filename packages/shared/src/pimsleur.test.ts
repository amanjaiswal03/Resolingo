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
  recallAnswersFollowPrompts,
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
      level: "A1",
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
      segment.pauseAfterMs && segments[index + 1]?.text === "Geradeaus."
    ))?.pauseAfterMs ?? Infinity);
    expect(answer?.pauseAfterMs).toBeUndefined();
    // A line of four words is built up from the end. A one-word line is not.
    const pieces = segments.filter((segment) => segment.phase === "buildup" && segment.language === "de-DE").map((segment) => segment.text);
    expect([...new Set(pieces)]).toEqual(["Bahnhof", "der Bahnhof"]);
    // Every turn is practised, not only the two focus phrases.
    for (const line of lines) expect(segments.some((segment) => segment.phase === "answer" && segment.text === line.text)).toBe(true);
    expect(drillsAreUnique(segments)).toBe(true);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
    expect(recallPromptsCiteMeanings(segments)).toBe(true);
    const answers = phrases.map((line) => segments.find((segment) => segment.phase === "answer" && segment.text === line.text));
    expect(answers.every(Boolean)).toBe(true);
    const pauses = segments.filter((segment) => segment.kind === "drill" && segment.pauseAfterMs);
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

  it("returns the first phrase after practicing another exchange", () => {
    const segments = arrangePimsleur({
      lines,
      phrases,
      cues,
      names,
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "A1",
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
    expect(recallAnswersFollowPrompts(cited)).toBe(true);
    const answerFirst = [
      line("Wo ist der Bahnhof?", { phase: "review", translation: "Where is the station?" }),
      line("How would you say Where is the station?", { speaker: "teacher", language: "en-US", phase: "review", pauseAfterMs: 5000 }),
      line("Wo ist der Bahnhof?", { phase: "review", translation: "Where is the station?" }),
    ];
    expect(recallAnswersFollowPrompts(answerFirst)).toBe(false);
    const quick = [
      line("Quick check. How would you say Where is the station?", { speaker: "teacher", language: "en-US", phase: "quick", pauseAfterMs: 5000 }),
      line("Wo ist der Bahnhof?", { speaker: "teacher", phase: "quick", translation: "Where is the station?" }),
    ];
    expect(recallAnswersFollowPrompts(quick)).toBe(true);
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
        { speaker: "speakerA", text: "Danke.", translation: "Thanks." },
      ],
      phrases: [
        { speaker: "speakerA", text: "Wo ist der Bahnhof?", translation: "Where is the station?", note: "A useful question." },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A1" });
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
      level: "A1",
      seed: 0,
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
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A1" });
    expect(legacy?.segments.filter((segment) => segment.phase === "dialogue").map((segment) => segment.text)).toEqual([
      "Einen Kaffee, bitte.",
      "Gerne.",
    ]);
    expect(legacy?.speakerNames.speakerB).toBe("Anna");
  });

  it("practises every turn once, in dialogue order, and keeps the whole scene", () => {
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
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A1" });
    const segments = shaped?.segments ?? [];
    // A line said twice in the scene is practised once.
    expect(segments.filter((segment) => segment.phase === "answer").map((segment) => segment.text))
      .toEqual(["Guten Morgen.", "Wie geht's?", "Gut, danke."]);
    expect(segments.filter((segment) => segment.kind === "dialogue" && segment.phase === "dialogue").map((segment) => segment.text))
      .toEqual(four.map((line) => line.text));
    const closing = segments.filter((segment) => segment.phase === "closing" && segment.speaker !== "teacher").map((segment) => segment.text);
    expect(closing).toEqual(four.map((line) => line.text));
    const pauses = segments.filter((segment) => segment.kind === "drill" && segment.pauseAfterMs);
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

  it("opens the welcome lesson with the app intro, and ignores it on other lessons", () => {
    const four = [
      { speaker: "speakerA", text: "Hallo, ich bin Lukas.", translation: "Hi, I'm Lukas.", language: "de-DE" },
      { speaker: "speakerB", text: "Hallo, ich bin Anna.", translation: "Hi, I'm Anna.", language: "de-DE" },
      { speaker: "speakerA", text: "Woher kommst du?", translation: "Where are you from?", language: "de-DE" },
      { speaker: "speakerB", text: "Aus Berlin. Tschüss!", translation: "From Berlin. Bye!", language: "de-DE" },
    ];
    const source = {
      title: "First hello",
      topic: "Introduce yourself",
      summary: "Say hello and your name.",
      lines: four,
      appIntro: ["Welcome to Resolingo.", "Each lesson is about six minutes of audio."],
      cues: { welcome: "Today you will meet two people." },
    };
    const options = { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A1" } as const;
    const welcome = shapePimsleurLesson(source, { ...options, welcome: true })?.segments ?? [];
    expect(welcome.slice(0, 3).map((segment) => segment.text)).toEqual(["Welcome to Resolingo.", "Each lesson is about six minutes of audio.", "Today you will meet two people."]);
    expect(welcome.slice(0, 3).every((segment) => segment.phase === "intro" && segment.speaker === "teacher")).toBe(true);
    const ordinary = shapePimsleurLesson(source, options)?.segments ?? [];
    expect(ordinary[0]?.text).toBe("Today you will meet two people.");
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
        { speaker: "speakerA", text: "Danke.", translation: "Thanks.", language: "de-DE" },
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
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A1" });
    const segments = shaped?.segments ?? [];
    const pauses = segments.filter((segment) => segment.kind === "drill" && segment.pauseAfterMs);
    expect(pauses.every((segment) => segment.speaker === "teacher" && segment.kind === "drill")).toBe(true);
    expect(pauses.some((segment) => /^(Can you say|Try saying|How would you say) Where is the station[.?]$/.test(segment.text))).toBe(true);
    for (let index = 1; index < pauses.length; index += 1) {
      expect(pauses[index]?.text.toLocaleLowerCase()).not.toBe(pauses[index - 1]?.text.toLocaleLowerCase());
    }
    const gloss = segments.find((segment) => segment.kind === "explanation" && segment.phase === "buildup");
    expect(gloss?.text).toContain("[[lang:de-DE]]Bahnhof[[/lang]]");
    expect(gloss?.text.toLowerCase()).toContain("means");
    expect(gloss).toMatchObject({ speaker: "teacher", language: "en-US" });
    expect(gloss?.pauseAfterMs).toBeLessThan(1_200);
    const glossAt = segments.indexOf(gloss!);
    expect(segments[glossAt - 1]?.text).not.toBe("Bahnhof");
    // "Repeat after Leo" first, then the model with a pause to repeat it, then the model again.
    expect(segments[glossAt + 1]).toMatchObject({ kind: "narration", speaker: "teacher", phase: "buildup" });
    expect(segments[glossAt + 1]?.text).toMatch(/^(Repeat after|Listen to) /);
    expect(segments[glossAt + 1]?.pauseAfterMs).toBeUndefined();
    expect(segments[glossAt + 2]).toMatchObject({ kind: "example", text: "Bahnhof", speaker: "speakerA" });
    expect(segments[glossAt + 2]?.pauseAfterMs).toBe(speakingPauseMs("Bahnhof", "de-DE"));
    expect(segments[glossAt + 3]).toMatchObject({ kind: "drill", text: "Bahnhof", speaker: "speakerA" });
    expect(segments.some((segment) => segment.text === "Anna" || segment.text === "Anna!")).toBe(false);
    expect(segments.filter((segment) => segment.kind === "explanation").every((segment) => (segment.pauseAfterMs ?? 0) < 1_200)).toBe(true);
    expect(segments.some((segment) => segment.text.includes("obvious"))).toBe(false);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
  });

  it("builds a long line from the end with the model's first two pieces, then asks for the whole line", () => {
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
        { speaker: "speakerB", text: "Geradeaus.", translation: "Straight ahead.", language: "de-DE" },
        { speaker: "speakerA", text: "Danke.", translation: "Thanks.", language: "de-DE" },
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
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A1" });
    const segments = shaped?.segments ?? [];
    expect(segments.filter((segment) => segment.phase === "buildup" && segment.kind === "example").map((segment) => segment.text))
      .toEqual(["Bahnhof", "der Bahnhof"]);
    // Each piece is introduced before it is heard, and the pause follows the speaker's model.
    const invitations = segments.filter((segment) => segment.phase === "buildup" && segment.kind === "narration");
    expect(invitations.map((segment) => segment.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^(Repeat after|Listen to) /)]));
    const echoes = segments.filter((segment) => segment.phase === "buildup" && segment.kind === "example" && segment.pauseAfterMs);
    expect(echoes.map((segment) => segment.text)).toEqual(["Bahnhof", "der Bahnhof"]);
    for (const echo of echoes) {
      const at = segments.indexOf(echo);
      expect(segments[at - 1]).toMatchObject({ speaker: "teacher", kind: "narration" });
      expect(segments[at + 1]).toMatchObject({ kind: "drill", text: echo.text });
    }
    const gloss = segments.find((segment) => segment.kind === "explanation" && segment.phase === "buildup" && segment.text.includes("der Bahnhof"));
    expect(gloss?.text).toContain("[[lang:de-DE]]der Bahnhof[[/lang]]");
    expect(gloss?.text.toLowerCase()).toMatch(/means|is how you say/);
    expect(gloss?.text.trim()).not.toBe("the train station");
    expect(segments[segments.indexOf(gloss!) + 1]).toMatchObject({ kind: "narration", speaker: "teacher" });
    expect(segments[segments.indexOf(gloss!) + 2]).toMatchObject({ kind: "example", text: "der Bahnhof" });
    // After the pieces, the whole line is asked for by its meaning.
    const whole = segments.findIndex((segment) => segment.phase === "recall" && segment.pauseAfterMs);
    expect(segments[whole - 1]).toMatchObject({ kind: "drill", text: "der Bahnhof" });
    expect(segments[whole]?.text.toLowerCase()).toContain("excuse me, where is the train station");
    expect(segments[whole + 1]?.text).toBe("Entschuldigung, wo ist der Bahnhof?");
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
    expect(drillsAreUnique(segments)).toBe(true);
  });

  it("drops a name from a drill, and never drills a line that is only a name", () => {
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
            { text: "Anna!", translation: "Anna" },
          ],
        },
        { speaker: "speakerB", text: "Geradeaus.", translation: "Straight ahead.", chunks: [] },
        { speaker: "speakerA", text: "Anna!", translation: "Anna!" },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A1" });
    const segments = shaped?.segments ?? [];
    const script = segments
      .filter((segment) => segment.phase === "buildup" || segment.phase === "answer")
      .map((segment) => `${segment.speaker}: ${segment.text}`);
    expect(script).toContain("speakerA: der Bahnhof");
    expect(segments.filter((segment) => segment.kind === "example" && segment.text === "der Bahnhof")).toHaveLength(1);
    expect(script.some((line) => line.includes("Anna"))).toBe(false);
    expect(segments.some((segment) => segment.phase === "buildup" && segment.text === "Geradeaus.")).toBe(false);
    expect(segments.some((segment) => segment.phase === "answer" && segment.text === "wo ist der Bahnhof?")).toBe(true);
    expect(segments.some((segment) => segment.phase === "answer" && segment.text === "Bitte.")).toBe(true);
    expect(segments.some((segment) => segment.phase === "dialogue" && segment.text === "Anna!")).toBe(true);
    expect(segments.some((segment) => segment.kind === "drill" && segment.text === "Anna!")).toBe(false);
    expect(drillsAreUnique(segments)).toBe(true);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
    expect(segments.length).toBeLessThanOrEqual(MAX_PIMSLEUR_SEGMENTS);
  });

  it("builds up every new line and then uses that line's own situation cue", () => {
    const first = { speaker: "speakerA", text: "Wo ist der Bahnhof?", translation: "Where is the station?" };
    const second = { speaker: "speakerB", text: "Gehen Sie geradeaus.", translation: "Go straight ahead." };
    const third = { speaker: "speakerA", text: "Vielen Dank.", translation: "Thank you very much." };
    const recallCue = "They're waiting for directions. Tell them: Go straight ahead.";
    const segments = shapePimsleurLesson({
      title: "Walking to the station",
      lines: [first, second, third],
      phrases: [
        { ...first, chunks: [{ text: "der Bahnhof", translation: "the station" }] },
        { ...second, recallCue, chunks: [{ text: "geradeaus", translation: "straight ahead" }] },
      ],
    }, { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A2" })!.segments;
    expect(segments.filter((segment) => segment.phase === "buildup" && segment.kind === "example").map((segment) => segment.text))
      .toEqual(["der Bahnhof", "geradeaus"]);
    const cue = segments.findIndex((segment) => segment.phase === "recall" && segment.text === recallCue);
    expect(segments[cue - 1]).toMatchObject({ kind: "drill", text: "geradeaus" });
    expect(segments[cue + 1]).toMatchObject({ kind: "drill", phase: "answer", text: second.text });
  });

  it("uses the level for thinking time, and practises every turn at every level", () => {
    const turns = [
      { speaker: "speakerA", text: "Wo ist der Bahnhof?", translation: "Where is the station?" },
      { speaker: "speakerB", text: "Gehen Sie geradeaus.", translation: "Go straight ahead." },
      { speaker: "speakerA", text: "Kann ich zu Fuß gehen?", translation: "Can I walk there?" },
      { speaker: "speakerB", text: "Ja, es ist ganz nah.", translation: "Yes, it's quite close." },
    ];
    const source = {
      title: "Finding the station",
      lines: turns,
      phrases: turns,
      usageTip: "A quick greeting makes a street question friendlier. This second fact is outside the lesson budget.",
      recombinations: [
        { speaker: "speakerA", text: "Wo ist das Rathaus?", translation: "Where is the town hall?" },
        { speaker: "speakerA", text: "Wann fährt der Zug?", translation: "When does the train leave?" },
      ],
    };
    const build = (level: "A1" | "C1") => shapePimsleurLesson(source, {
      nativeLanguage: "en-US", targetLanguage: "de-DE", level,
    })!.segments;
    const beginner = build("A1");
    const advanced = build("C1");
    expect(beginner.filter((part) => part.phase === "answer").map((part) => part.text)).toEqual(turns.map((turn) => turn.text));
    expect(advanced.filter((part) => part.phase === "answer").map((part) => part.text)).toEqual(turns.map((turn) => turn.text));
    expect(beginner.find((part) => part.phase === "recall")?.pauseAfterMs)
      .toBeGreaterThan(advanced.find((part) => part.phase === "recall")?.pauseAfterMs ?? Infinity);
    expect(beginner.filter((part) => part.phase === "recombine" && part.kind === "example").map((part) => part.text))
      .toEqual(["Wo ist das Rathaus?"]);
    expect(beginner.filter((part) => part.phase === "usage").map((part) => part.text))
      .toEqual(["A quick greeting makes a street question friendlier."]);
    // Each earlier turn comes back after other material, and again in the role-play after the closing dialogue.
    for (const item of turns.slice(0, 2)) {
      const first = beginner.findIndex((part) => part.phase === "answer" && part.text === item.text);
      const review = beginner.findIndex((part) => part.phase === "review" && part.text === item.text);
      expect(review).toBeGreaterThan(first + 2);
    }
    const closingAt = beginner.findIndex((part) => part.kind === "dialogue" && part.phase === "closing");
    const roleplay = beginner.filter((part, index) => index > closingAt && part.phase === "roleplay" && part.kind === "drill" && part.speaker !== "teacher");
    expect(roleplay.length).toBe(2);
    expect(recallAnswersFollowPrompts(beginner)).toBe(true);
  });

  it("acknowledges a line the learner already knows instead of drilling it", () => {
    const lines = [
      { speaker: "speakerA", text: "Guten Tag!", translation: "Good afternoon!", language: "de-DE" },
      { speaker: "speakerB", text: "Guten Tag. Was darf es sein?", translation: "Good afternoon. What can I get you?", language: "de-DE" },
      { speaker: "speakerA", text: "Einen Kaffee, bitte.", translation: "A coffee, please.", language: "de-DE" },
      { speaker: "speakerB", text: "Gern. Sonst noch etwas?", translation: "Sure. Anything else?", language: "de-DE", known: true },
      { speaker: "speakerA", text: "Nein, danke.", translation: "No, thanks.", language: "de-DE" },
    ];
    const shaped = shapePimsleurLesson({ title: "At the café", lines, phrases: lines }, {
      nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A2",
      known: [
        { text: "Einen Kaffee bitte", translation: "A coffee, please." },
        { text: "Gerne. Noch etwas?", translation: "Sure. Anything else?" },
        { text: "Danke schön.", translation: "Thank you." },
      ],
    });
    const segments = shaped?.segments ?? [];
    const answers = segments.filter((segment) => segment.phase === "answer").map((segment) => segment.text);
    // An exact repeat (punctuation aside) is skipped. The model's mark on a line with a new word
    // ("Sonst") is not trusted, so that line is drilled rather than called known.
    expect(answers).toEqual(["Guten Tag!", "Guten Tag. Was darf es sein?", "Gern. Sonst noch etwas?", "Nein, danke."]);
    const known = segments.filter((segment) => segment.phase === "known");
    expect(known.map((segment) => segment.speaker === "teacher" ? "T" : segment.text)).toEqual([
      "T", "Einen Kaffee, bitte.",
    ]);
    expect(known.filter((segment) => segment.speaker === "teacher").every((segment) => /already know|learned this|familiar/i.test(segment.text))).toBe(true);
    expect(known.every((segment) => !segment.pauseAfterMs)).toBe(true);
    expect(segments.some((segment) => segment.phase === "review" && segment.text === "Einen Kaffee, bitte.")).toBe(false);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
  });

  it("points out the grammar from the last lesson on the line that uses it", () => {
    const lines = [
      { speaker: "speakerA", text: "Hast du heute Zeit?", translation: "Do you have time today?", language: "de-DE" },
      { speaker: "speakerB", text: "Nein, ich muss arbeiten.", translation: "No, I have to work.", language: "de-DE" },
      { speaker: "speakerA", text: "Schade. Und morgen?", translation: "Too bad. And tomorrow?", language: "de-DE" },
      { speaker: "speakerB", text: "Morgen geht es.", translation: "Tomorrow works.", language: "de-DE" },
    ];
    const note = "[[lang:de-DE]]muss[[/lang]] is the modal verb from last time, and [[lang:de-DE]]arbeiten[[/lang]] goes to the end.";
    const segments = shapePimsleurLesson({ title: "Making plans", lines, phrases: lines, grammarLink: { line: "Nein, ich muss arbeiten.", note } }, {
      nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A2",
    })!.segments;
    const link = segments.findIndex((segment) => segment.phase === "link");
    expect(segments[link]).toMatchObject({ speaker: "teacher", kind: "explanation" });
    expect(segments[link]?.text).toContain("[[lang:de-DE]]muss[[/lang]]");
    expect(segments[link - 1]).toMatchObject({ kind: "example", text: "Nein, ich muss arbeiten." });
  });

  it("recalls earlier lines, recombines them, warms up with due phrases, and ends with a role-play", () => {
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
    }, {
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "B1",
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
    expect(segments[warmup]?.speaker).toBe("teacher");
    expect(segments[warmup]?.text.toLowerCase()).toContain("a coffee, please");
    expect(segments[warmup + 1]).toMatchObject({ text: "Einen Kaffee, bitte.", phase: "warmup" });
    const dialogueAt = segments.findIndex((segment) => segment.phase === "dialogue");
    expect(warmup).toBeLessThan(dialogueAt);
    expect(segments.slice(warmup, dialogueAt).some((segment) => /today's conversation/i.test(segment.text))).toBe(true);
    // Two due phrases warm up the lesson; a third waits for a later one.
    expect(segments.filter((segment) => segment.phase === "warmup" && segment.speaker !== "teacher").map((segment) => segment.text))
      .toEqual(priorTexts.slice(0, 2));
    expect(priorReviewsAreIntroduced(segments, priorTexts.slice(0, 2))).toBe(true);
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
    // The learner takes one part of the conversation; the other part is played between their lines.
    const intro = segments.findIndex((segment) => segment.phase === "roleplay" && segment.speaker === "teacher" && !segment.pauseAfterMs);
    expect(segments[intro]?.text).toMatch(/^Now you play (Lukas|Anna)\./);
    const roleplay = segments.slice(intro + 1, -1);
    expect(roleplay.filter((segment) => segment.kind === "dialogue").length).toBe(2);
    expect(roleplay.filter((segment) => segment.kind === "drill" && segment.speaker !== "teacher").length).toBe(2);
    const recalls = segments.filter((segment) => segment.phase === "review" && segment.pauseAfterMs);
    expect(recalls.length).toBeGreaterThan(0);
    expect(recalls.every((segment) => {
      const answer = segments[segments.indexOf(segment) + 1];
      return answer?.translation && segment.text.toLowerCase().includes(answer.translation.replace(/[.!?？。]+$/u, "").trim().toLowerCase());
    })).toBe(true);
    expect(recallPromptsCiteMeanings(segments)).toBe(true);
    expect(recallAnswersFollowPrompts(segments)).toBe(true);
    expect(drillsAreUnique(segments)).toBe(true);
    expect(speakPromptsMatchAnswers(segments)).toBe(true);
    for (const [index, prompt] of segments.entries()) {
      if (!prompt.pauseAfterMs || prompt.kind !== "drill") continue;
      const answer = segments[index + 1]!;
      expect(prompt.speaker).toBe("teacher");
      // An echo of what was just heard gets no extra thinking time.
      const thinking = prompt.phase === "buildup" ? 0 : 1_000;
      expect(prompt.pauseAfterMs).toBe(speakingPauseMs(answer.text, answer.language) + thinking);
      const fromEarlierLesson = priorTexts.includes(answer.text);
      if (fromEarlierLesson) {
        expect(segments.slice(0, index).some((segment) => segment.kind === "example" && segment.text === answer.text)).toBe(false);
      } else {
        expect(segments.slice(0, index)).toContainEqual(expect.objectContaining({
          kind: "example", text: answer.text, language: answer.language,
        }));
      }
    }
  });
});
