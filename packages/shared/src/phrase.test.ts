import { describe, expect, it } from "vitest";
import { displayLessonSegment, lessonDisplayText } from "./markup.js";
import {
  answerWordsAreGlossed,
  focusesAreGlossedFirst,
  phraseAnswersStayVaried,
  phraseIdFor,
  phraseIdsToPrune,
  phraseLessonPace,
  phraseLinesAreDistinct,
  phraseLookupLimit,
  phrasePromptsAreClear,
  shapePhraseLesson,
  type PhraseLessonContext,
} from "./phrase.js";
import { recallAnswersFollowPrompts } from "./pimsleur.js";
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
  pattern: "After muss, möchte, or will, the other verb goes to the end, so kaufen is at the end.",
  chunks: [
    { text: "Schuhe", translation: "shoes" },
    { text: "ein Paar Schuhe", translation: "a pair of shoes" },
    { text: "ein Paar Schuhe kaufen", translation: "to buy a pair of shoes" },
  ],
  swaps: [
    { from: "shoes", to: "a jacket", focus: "eine Jacke", focusTranslation: "a jacket", answer: "Ich muss eine Jacke kaufen.", translation: "I need to buy a jacket" },
    { from: "shoes", to: "tickets", focus: "Tickets", focusTranslation: "tickets", answer: "Ich muss Tickets kaufen.", translation: "I need to buy tickets" },
  ],
  situations: [
    { setup: "You're in a shoe shop. The clerk asks what you're looking for.", focus: "möchte", focusTranslation: "would like", usage: "Möchte is the polite would like. Will is blunter, fine with a friend, not the first choice with a clerk.", answer: "Ich möchte ein Paar Schuhe kaufen.", translation: "I would like to buy a pair of shoes" },
    { setup: "A friend asks why you're going into town.", focus: "noch", focusTranslation: "still", answer: "Ich muss noch Schuhe kaufen.", translation: "I still need to buy shoes" },
    { setup: "You're ordering online and you have to name what you need.", focus: "Ich brauche", focusTranslation: "I need", words: [{ text: "neue", translation: "new" }], answer: "Ich brauche neue Schuhe.", translation: "I need new shoes" },
  ],
  roleplay: {
    setup: "You're at the counter. The clerk is waiting.",
    answer: "Ich möchte ein Paar Schuhe kaufen.",
    translation: "I would like to buy a pair of shoes",
  },
};

function lessonFor(level: PhraseLessonContext["level"], extra: Partial<PhraseLessonContext> = {}) {
  const result = shapePhraseLesson(shoesModel, { ...shoes, level, ...extra });
  if (!result.ok) throw new Error(result.reason);
  return result.lesson;
}

function expectLesson(result: ReturnType<typeof shapePhraseLesson>) {
  if (!result.ok) throw new Error(result.reason);
  return result.lesson;
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
    expect(lesson.segments.length).toBeLessThanOrEqual(110);
    expect(lesson.segments.length).toBeLessThanOrEqual(120);
    expect(lesson.segments.every((segment) => segment.speaker === "teacher")).toBe(true);
    expect(phrasePromptsAreClear(lesson.segments)).toBe(true);
    expect(phraseLinesAreDistinct(lesson.segments)).toBe(true);
    expect(phraseAnswersStayVaried(lesson.segments, "de-DE")).toBe(true);
  });

  it("glosses a new swap word before the learner has to produce it", () => {
    expect(focusesAreGlossedFirst(lesson.segments, ["eine Jacke", "Tickets", "möchte", "noch", "Ich brauche", "neue"])).toBe(true);
    expect(answerWordsAreGlossed(lesson.segments, "de-DE", shoes.translation)).toBe(true);
    expect(lesson.segments.some((segment) => segment.text.includes("neue") && segment.text.includes("means"))).toBe(true);
    expect(lesson.segments.some((segment) => segment.text.includes("Tickets is the same word."))).toBe(true);
    expect(lesson.segments.some((segment) => /Tickets means/i.test(segment.text))).toBe(false);
    const pauses = lesson.segments.filter((segment) => (segment.pauseAfterMs ?? 0) > 0);
    const jacketCue = pauses.find((pause) => pause.text.includes("instead of shoes, a jacket"));
    expect(jacketCue?.text).toBe("Now, instead of shoes, a jacket. How would you say I need to buy a jacket?");
    expect(pauses.some((pause) => pause.text.includes("Ich muss ein Paar Schuhe kaufen"))).toBe(false);
    const answers = lesson.segments.filter((segment) => segment.language === "de-DE").map((segment) => segment.text);
    expect(answers).toContain("Ich muss eine Jacke kaufen.");
    expect(answers).toContain("Ich muss Tickets kaufen.");
    expect(answers).not.toContain("Ich will ein Paar Schuhe kaufen.");
    const coreCount = answers.filter((text) => text === "Ich muss ein Paar Schuhe kaufen.").length;
    expect(coreCount).toBeGreaterThan(0);
    expect(coreCount).toBeLessThanOrEqual(5);
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

  it("uses three different situation lines, one pattern note, and a concrete recap", () => {
    const setups = lesson.segments.filter((segment) => segment.phase === "situation" && segment.kind === "narration");
    expect(setups.map((segment) => segment.text)).toEqual([
      "You're in a shoe shop. The clerk asks what you're looking for.",
      "A friend asks why you're going into town.",
      "You're ordering online and you have to name what you need.",
    ]);
    const situationAnswers = lesson.segments.filter((segment) => segment.phase === "answer" && segment.language === "de-DE").map((segment) => segment.text);
    expect(new Set([
      "Ich möchte ein Paar Schuhe kaufen.",
      "Ich muss noch Schuhe kaufen.",
      "Ich brauche neue Schuhe.",
    ]).size).toBe(3);
    for (const line of ["Ich möchte ein Paar Schuhe kaufen.", "Ich muss noch Schuhe kaufen.", "Ich brauche neue Schuhe."]) {
      expect(situationAnswers).toContain(line);
    }
    expect(lesson.segments.filter((segment) => segment.phase === "pattern")).toHaveLength(1);
    expect(lesson.segments.some((segment) => segment.text.includes("the other verb goes to the end"))).toBe(true);
    const summary = lesson.segments.filter((segment) => segment.phase === "summary" && segment.language === "de-DE").map((segment) => segment.text);
    expect(summary).toEqual([
      "Ich muss ein Paar Schuhe kaufen.",
      "Ich muss eine Jacke kaufen.",
      "Ich möchte ein Paar Schuhe kaufen.",
    ]);
    const summaryCues = lesson.segments.filter((segment) => segment.phase === "summary" && segment.language === "en-US").map((segment) => segment.text);
    expect(summaryCues.every((line) => line.endsWith(".") && line.split(" ").length >= 6)).toBe(true);
    expect(summaryCues.join(" ")).not.toContain("Keep these");
    const quick = lesson.segments.filter((segment) => segment.phase === "quick" && segment.language === "de-DE").map((segment) => segment.text);
    expect(quick).toEqual([
      "Ich muss eine Jacke kaufen.",
      "Ich muss noch Schuhe kaufen.",
      "Ich muss ein Paar Schuhe kaufen.",
    ]);
    const quickCues = lesson.segments.filter((segment) => segment.phase === "quick" && segment.pauseAfterMs).map((segment) => segment.text);
    expect(new Set(quickCues).size).toBe(quickCues.length);
    expect(quickCues[0]).toContain("Quick check");
    expect(recallAnswersFollowPrompts(lesson.segments)).toBe(true);
    const closing = lesson.segments.find((segment) => segment.phase === "closing")?.text ?? "";
    expect(closing).toContain("I would like to buy a pair of shoes");
    expect(closing).toContain("I still need to buy shoes");
    expect(closing).not.toContain("the first one");
    const roleplay = lesson.segments.filter((segment) => segment.phase === "roleplay" && segment.language === "de-DE");
    expect(roleplay.map((segment) => segment.text)).toEqual(["Ich möchte ein Paar Schuhe kaufen."]);
  });

  it("keeps A1 shorter, with chunks, and B1 on the whole phrase plus a formal alternative", () => {
    const beginner = lessonFor("A1");
    const later = lessonFor("B1", {
      alternatives: [{ label: "formally", text: "Ich hätte gern ein Paar Schuhe.", words: [{ text: "hätte gern", translation: "would like" }] }],
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

  it("leaves phrases from earlier lessons out, even when some are due", () => {
    const lesson = lessonFor("A2", {
      priorReviews: [{ text: "Danke.", translation: "Thanks." }],
    });
    expect(lesson).not.toBeNull();
    expect(lesson!.segments.some((segment) => segment.text.includes("Danke") || segment.phase === "warmup")).toBe(false);
  });

  it("does not drill an idiom's literal gloss, and it keeps a name", () => {
    const idiom = expectLesson(shapePhraseLesson({
      ...shoesModel,
      chunks: [],
      swaps: [
        { from: "pouring", to: "starting", focus: "fängt an", focusTranslation: "is starting", words: [{ text: "zu regnen", translation: "to rain" }], answer: "Es fängt an zu regnen.", translation: "It's starting to rain" },
        { from: "the rain", to: "the weather", focus: "das Wetter", focusTranslation: "the weather", words: [{ text: "ist schlecht", translation: "is bad" }], answer: "Das Wetter ist schlecht.", translation: "The weather is bad" },
      ],
      situations: [
        { setup: "A friend asks if it is still raining.", focus: "noch", focusTranslation: "still", answer: "Es regnet noch.", translation: "It's still raining" },
        { setup: "You're telling a clerk the rain is heavy.", focus: "stark", focusTranslation: "heavy", answer: "Es regnet stark.", translation: "It's raining heavily" },
        { setup: "You're sending a short update.", focus: "heute", focusTranslation: "today", answer: "Es regnet heute.", translation: "It's raining today" },
      ],
    }, {
      ...shoes,
      nativeText: "It's raining cats and dogs",
      translation: "Es regnet in Strömen.",
      note: "Literally, that is cats and dogs.",
    }));
    const notes = idiom.segments.filter((segment) => segment.text === "Literally, that is cats and dogs.");
    expect(notes).toHaveLength(1);
    expect(idiom.segments.some((segment) => segment.language === "de-DE" && segment.text.includes("cats and dogs"))).toBe(false);
    expect(idiom.segments.some((segment) => segment.text.includes("not the word-for-word"))).toBe(true);

    const named = expectLesson(shapePhraseLesson({
      ...shoesModel,
      chunks: [],
      swaps: [
        { from: "the station", to: "the café", focus: "im Café", focusTranslation: "at the café", answer: "Ich muss Anna im Café treffen.", translation: "I need to meet Anna at the café" },
        { from: "Anna", to: "Lukas", focus: "Lukas", focusTranslation: "Lukas", answer: "Ich muss Lukas am Bahnhof treffen.", translation: "I need to meet Lukas at the station" },
      ],
      situations: [
        { setup: "You're at the station. The clerk asks who you're meeting.", focus: "möchte", focusTranslation: "would like", usage: "Möchte is the polite would like.", answer: "Ich möchte Anna am Bahnhof treffen.", translation: "I would like to meet Anna at the station" },
        { setup: "A friend asks why you're heading out.", focus: "noch", focusTranslation: "still", answer: "Ich muss Anna noch treffen.", translation: "I still need to meet Anna" },
        { setup: "You're writing to say when.", focus: "heute", focusTranslation: "today", answer: "Ich muss Anna heute treffen.", translation: "I need to meet Anna today" },
      ],
    }, {
      ...shoes,
      nativeText: "I need to meet Anna at the station",
      translation: "Ich muss Anna am Bahnhof treffen.",
    }));
    expect(named.segments.some((segment) => segment.text.includes("Anna"))).toBe(true);
    expect(named.segments.some((segment) => segment.text === "Anna")).toBe(false);
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
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe("swaps_short");
  });

  it("rejects a repeated setup and a sentence said too many times", () => {
    const setup = "You're in a shoe shop. The clerk asks what you're looking for.";
    const prompt = `${setup} How would you say I need to buy a pair of shoes?`;
    const repeated = [
      { id: "seg_01", speaker: "teacher" as const, kind: "narration" as const, phase: "situation", language: "en-US" as const, text: setup, delivery: "warm" as const },
      { id: "seg_02", speaker: "teacher" as const, kind: "drill" as const, phase: "situation", language: "en-US" as const, text: prompt, delivery: "curious" as const, pauseAfterMs: 5000 },
    ];
    expect(phraseLinesAreDistinct(repeated)).toBe(false);
    const copies = Array.from({ length: 6 }, (_, index) => ({
      id: `seg_${index}`,
      speaker: "teacher" as const,
      kind: "example" as const,
      phase: "answer",
      language: "de-DE" as const,
      text: "Ich muss ein Paar Schuhe kaufen.",
      translation: "I need to buy a pair of shoes",
      delivery: "clear" as const,
    }));
    expect(phraseAnswersStayVaried(copies, "de-DE")).toBe(false);
    const situationLines = lesson.segments.filter((segment) => segment.phase === "answer" && segment.language === "de-DE").map((segment) => segment.text);
    const distinct = situationLines.filter((text) => text !== "Ich muss ein Paar Schuhe kaufen.");
    expect(new Set(distinct).size).toBe(distinct.length);
  });

  it("shapes a hearing check, including the formal Sie alternative", () => {
    const model = {
      title: "Hearing check",
      topic: "Can you hear me clearly?",
      summary: "Practice asking if someone can hear you, then change who and how well.",
      speakerNames: { teacher: "Mira" },
      pattern: "In a yes-no question, the verb comes first.",
      chunks: [
        { text: "hören", translation: "hear" },
        { text: "deutlich hören", translation: "hear clearly" },
        { text: "mich deutlich hören", translation: "hear me clearly" },
      ],
      swaps: [
        { from: "you", to: "he", focus: "Kann er", focusTranslation: "can he", answer: "Kann er mich deutlich hören?", translation: "Can he hear me clearly?" },
        { from: "clearly", to: "well", focus: "gut", focusTranslation: "well", answer: "Kannst du mich gut hören?", translation: "Can you hear me well?" },
      ],
      situations: [
        {
          setup: "You're on a video call and the picture just came back.",
          focus: "jetzt",
          focusTranslation: "now",
          answer: "Kannst du mich jetzt hören?",
          translation: "Can you hear me now?",
        },
        {
          setup: "A friend is across a noisy room.",
          focus: "Hörst",
          focusTranslation: "do you hear",
          answer: "Hörst du mich?",
          translation: "Can you hear me?",
        },
      ],
      roleplay: {
        setup: "You're on a video call and the picture just came back.",
        answer: "Kannst du mich jetzt hören?",
        translation: "Can you hear me now?",
      },
    };
    const context: PhraseLessonContext = {
      phraseId: "phrase_hear0001",
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "A1",
      nativeText: "Can you hear me clearly?",
      translation: "Kannst du mich deutlich hören?",
      inputLanguage: "native",
      alternatives: [{ label: "formally", text: "Können Sie mich deutlich hören?", words: [{ text: "Können Sie", translation: "can you" }] }],
    };
    const lesson = expectLesson(shapePhraseLesson(model, context));
    expect(phrasePromptsAreClear(lesson.segments)).toBe(true);
    expect(phraseLinesAreDistinct(lesson.segments)).toBe(true);
    expect(phraseAnswersStayVaried(lesson.segments, "de-DE")).toBe(true);
    expect(answerWordsAreGlossed(lesson.segments, "de-DE", context.translation)).toBe(true);
    expect(focusesAreGlossedFirst(lesson.segments, ["hören", "deutlich hören", "mich deutlich hören", "Kann er", "gut", "jetzt", "Hörst", "Können Sie"])).toBe(true);
    expect(lesson.segments.filter((segment) => segment.phase === "pattern")).toHaveLength(1);
    const formal = lesson.segments.findIndex((segment) => segment.text === "Können Sie mich deutlich hören?");
    const gloss = lesson.segments.findIndex((segment) => segment.text.includes("Können Sie") && segment.text.includes("means \"can you\""));
    expect(gloss).toBeGreaterThanOrEqual(0);
    expect(formal).toBeGreaterThan(gloss);
    expect(lesson.segments.some((segment) => segment.text.includes("With a clerk"))).toBe(false);
    expect(lesson.segments.some((segment) => /too loud|connection/i.test(segment.text))).toBe(false);
    expect(lesson.segments.some((segment) => segment.text.includes("A more formal way to say it"))).toBe(true);
    const closing = lesson.segments.find((segment) => segment.phase === "closing")?.text ?? "";
    expect(closing).toContain("Can you hear me clearly");
    expect(closing).toContain("Can you hear me");
    const prompts = lesson.segments.filter((segment) => (segment.pauseAfterMs ?? 0) > 0);
    expect(prompts.some((segment) => /can you say can\b/i.test(segment.text))).toBe(false);
    for (let index = 0; index < lesson.segments.length; index += 1) {
      const prompt = lesson.segments[index];
      if (!prompt?.pauseAfterMs) continue;
      const answer = lesson.segments[index + 1];
      if (answer?.translation?.trim().endsWith("?")) expect(prompt.text.trim().endsWith("?")).toBe(true);
    }
    expect(lesson.segments.some((segment) => segment.text === "Kannst du mich jetzt hören?")).toBe(true);
    expect(lesson.segments.some((segment) => segment.text === "Hörst du mich?")).toBe(true);
    const coreCount = lesson.segments.filter((segment) => segment.text === "Kannst du mich deutlich hören?").length;
    expect(coreCount).toBeGreaterThan(0);
    expect(coreCount).toBeLessThanOrEqual(5);

    const unglossed = shapePhraseLesson(model, {
      ...context,
      alternatives: [{ label: "formally", text: "Können Sie mich deutlich hören?" }],
    });
    const bare = expectLesson(unglossed);
    expect(answerWordsAreGlossed(bare.segments, "de-DE", context.translation)).toBe(true);
    expect(bare.segments.some((segment) => segment.text.includes("Können Sie") && segment.text.includes("means \"formally\""))).toBe(true);
    expect(bare.segments.some((segment) => /Können Sie mich deutlich hören means/i.test(segment.text))).toBe(false);
  });

  it("shapes a question about the train station without a shop", () => {
    const context: PhraseLessonContext = {
      phraseId: "phrase_station1",
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "A2",
      nativeText: "Where is the train station?",
      translation: "Wo ist der Bahnhof?",
      inputLanguage: "native",
    };
    const lesson = expectLesson(shapePhraseLesson({
      title: "Finding the train station",
      topic: "Where is the train station?",
      summary: "Practice asking where the train station is, then ask about other places.",
      speakerNames: { teacher: "Mira" },
      pattern: "A question with wo starts with the question word.",
      chunks: [
        { text: "Bahnhof", translation: "station" },
        { text: "der Bahnhof", translation: "the train station" },
        { text: "ist der Bahnhof", translation: "is the train station" },
      ],
      swaps: [
        { from: "the train station", to: "the hotel", focus: "das Hotel", focusTranslation: "the hotel", answer: "Wo ist das Hotel?", translation: "Where is the hotel?" },
        { from: "is", to: "is located", focus: "liegt", focusTranslation: "is located", answer: "Wo liegt der Bahnhof?", translation: "Where is the train station located?" },
      ],
      situations: [
        { setup: "You're on a street corner and someone is walking past.", focus: "in der Nähe", focusTranslation: "nearby", answer: "Ist der Bahnhof in der Nähe?", translation: "Is the train station nearby?" },
        { setup: "A friend is meeting you and asks which way.", focus: "links", focusTranslation: "left", answer: "Der Bahnhof ist links.", translation: "The train station is on the left." },
        { setup: "You're looking at a sign in the station hall.", focus: "hier", focusTranslation: "here", answer: "Wo ist der Bahnhof hier?", translation: "Where is the train station here?" },
      ],
      roleplay: { setup: "You're looking at a sign in the station hall.", answer: "Wo ist der Bahnhof hier?", translation: "Where is the train station here?" },
    }, context));
    expect(phrasePromptsAreClear(lesson.segments)).toBe(true);
    expect(phraseLinesAreDistinct(lesson.segments)).toBe(true);
    expect(phraseAnswersStayVaried(lesson.segments, "de-DE")).toBe(true);
    expect(answerWordsAreGlossed(lesson.segments, "de-DE", context.translation)).toBe(true);
    expect(focusesAreGlossedFirst(lesson.segments, ["Bahnhof", "der Bahnhof", "ist der Bahnhof", "das Hotel", "liegt", "in der Nähe", "links", "hier"])).toBe(true);
    const stationAnswers = lesson.segments.filter((segment) => segment.phase === "answer" && segment.language === "de-DE").map((segment) => segment.text);
    for (const line of ["Ist der Bahnhof in der Nähe?", "Der Bahnhof ist links.", "Wo ist der Bahnhof hier?"]) {
      expect(stationAnswers).toContain(line);
    }
    expect(lesson.segments.filter((segment) => segment.phase === "pattern")).toHaveLength(1);
    expect(lesson.segments.some((segment) => /\b(clerk|shop)\b/i.test(segment.text))).toBe(false);
    const setups = lesson.segments.filter((segment) => segment.phase === "situation" && segment.kind === "narration").map((segment) => segment.text);
    expect(new Set(setups).size).toBe(setups.length);
    expect(setups.length).toBeGreaterThanOrEqual(3);
    const coreCount = lesson.segments.filter((segment) => segment.text === "Wo ist der Bahnhof?").length;
    expect(coreCount).toBeLessThanOrEqual(5);
  });

  it("teaches a two-sentence phrase one sentence at a time, then both together", () => {
    const context: PhraseLessonContext = {
      phraseId: "phrase_late0001",
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "A1",
      nativeText: "I'm running late. I need to get there faster.",
      translation: "Ich komme zu spät. Ich muss schneller dorthin kommen.",
      inputLanguage: "native",
      alternatives: [{
        label: "casual",
        text: "Ich bin spät dran. Ich muss schneller da sein.",
        words: [
          { text: "bin", translation: "am" },
          { text: "spät dran", translation: "running late" },
          { text: "da sein", translation: "be there" },
        ],
      }],
    };
    const lesson = expectLesson(shapePhraseLesson({
      title: "Running late",
      topic: "I'm running late. I need to get there faster.",
      summary: "Practice saying you are running late and that you need to get there faster.",
      speakerNames: { teacher: "Mira" },
      pattern: "Schneller comes before the place, and kommen stays at the end.",
      chunks: [
        { text: "spät", translation: "late" },
        { text: "zu spät", translation: "too late" },
        { text: "Ich komme", translation: "I'm coming" },
        { text: "kommen", translation: "to get" },
        { text: "dorthin", translation: "there" },
        { text: "schneller", translation: "faster" },
        { text: "muss", translation: "need to" },
      ],
      swaps: [
        { from: "faster", to: "now", focus: "jetzt", focusTranslation: "now", answer: "Ich komme zu spät. Ich muss jetzt dorthin kommen.", translation: "I'm running late. I need to get there now." },
        { from: "there", to: "home", focus: "nach Hause", focusTranslation: "home", answer: "Ich komme zu spät. Ich muss schneller nach Hause kommen.", translation: "I'm running late. I need to get home faster." },
      ],
      situations: [
        { setup: "You're calling from the station.", focus: "zum Bahnhof", focusTranslation: "to the station", answer: "Ich komme zu spät. Ich muss schneller zum Bahnhof kommen.", translation: "I'm running late. I need to get to the station faster." },
        { setup: "You're in a taxi and the meeting has started.", focus: "sofort", focusTranslation: "right away", answer: "Ich komme zu spät. Ich muss sofort dorthin kommen.", translation: "I'm running late. I need to get there right away." },
      ],
      roleplay: { setup: "You're in a taxi and the meeting has started.", answer: "Ich komme zu spät. Ich muss sofort dorthin kommen.", translation: "I'm running late. I need to get there right away." },
    }, context));
    expect(phrasePromptsAreClear(lesson.segments)).toBe(true);
    expect(phraseLinesAreDistinct(lesson.segments)).toBe(true);
    expect(phraseAnswersStayVaried(lesson.segments, "de-DE")).toBe(true);
    expect(answerWordsAreGlossed(lesson.segments, "de-DE", context.translation)).toBe(true);
    expect(focusesAreGlossedFirst(lesson.segments, ["spät", "zu spät", "Ich komme", "kommen", "dorthin", "schneller", "muss", "jetzt", "nach Hause", "zum Bahnhof", "sofort", "bin", "spät dran", "da sein"])).toBe(true);
    const german = lesson.segments.filter((segment) => segment.language === "de-DE").map((segment) => segment.text);
    const first = german.indexOf("Ich komme zu spät.");
    const second = german.indexOf("Ich muss schneller dorthin kommen.");
    const both = german.findIndex((text, index) => index > second && text === "Ich komme zu spät. Ich muss schneller dorthin kommen.");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(both).toBeGreaterThan(second);
    expect(lesson.segments.some((segment) => segment.text.includes("one sentence at a time"))).toBe(true);
    expect(lesson.segments.some((segment) => segment.text.includes("Now both sentences together."))).toBe(true);
    const closing = lesson.segments.find((segment) => segment.phase === "closing")?.text ?? "";
    expect(closing).toContain("I'm running late. I need to get there faster");
    expect(closing).toContain("Ich bin spät dran. Ich muss schneller da sein.");
    expect(closing).not.toContain("coming later");
    expect(lesson.segments.some((segment) => segment.text === "Ich bin spät dran. Ich muss schneller da sein.")).toBe(true);
    const shown = lesson.segments.map((segment) => lessonDisplayText(segment.text));
    expect(shown.some((text) => text.includes("spät dran means \"running late\""))).toBe(true);
    expect(shown.some((text) => text.includes("da sein means \"be there\""))).toBe(true);
    expect(shown.some((text) => /^dran means/i.test(text))).toBe(false);
    expect(lesson.segments.some((segment) => segment.text.includes("Instead of faster, now."))).toBe(true);
    expect(lesson.segments.some((segment) => /Now, instead of faster, now/i.test(segment.text))).toBe(false);
    expect(lesson.segments.some((segment) => segment.text.includes("Ich komme später"))).toBe(false);
    const prompts = lesson.segments.filter((segment) => (segment.pauseAfterMs ?? 0) > 0);
    expect(prompts.some((segment) => /can you say can\b/i.test(segment.text))).toBe(false);
    let fresh = 0;
    for (const segment of lesson.segments) {
      if ((segment.pauseAfterMs ?? 0) > 0) {
        expect(fresh).toBeLessThanOrEqual(2);
        fresh = 0;
      }
      if (/means\s+["“]/i.test(segment.text) || /is the same word/i.test(segment.text)) fresh += 1;
    }
  });

  it("requires a gloss for a short word that is not in the core sentence", () => {
    const core = "Kannst du mich deutlich hören?";
    const ask = { id: "seg_01", speaker: "teacher" as const, kind: "drill" as const, phase: "practice", language: "en-US" as const, text: "Your turn: It's too loud?", delivery: "curious" as const, pauseAfterMs: 5000 };
    const answer = { id: "seg_02", speaker: "teacher" as const, kind: "drill" as const, phase: "answer", language: "de-DE" as const, text: "Es ist zu laut.", translation: "It's too loud.", delivery: "clear" as const };
    expect(answerWordsAreGlossed([ask, answer], "de-DE", core)).toBe(false);
    const taught = [
      { id: "seg_a", speaker: "teacher" as const, kind: "explanation" as const, phase: "situation", language: "en-US" as const, text: "Es means \"it\".", delivery: "clear" as const },
      { id: "seg_b", speaker: "teacher" as const, kind: "explanation" as const, phase: "situation", language: "en-US" as const, text: "ist means \"is\".", delivery: "clear" as const },
      { id: "seg_c", speaker: "teacher" as const, kind: "drill" as const, phase: "focus", language: "en-US" as const, text: "Your turn: is?", delivery: "curious" as const, pauseAfterMs: 5000 },
      { id: "seg_d", speaker: "teacher" as const, kind: "explanation" as const, phase: "situation", language: "en-US" as const, text: "zu laut means \"too loud\".", delivery: "clear" as const },
      ask,
      answer,
    ];
    expect(answerWordsAreGlossed(taught, "de-DE", core)).toBe(true);
  });

  it("rejects situations that leave the phrase, and still shapes three separate glosses", () => {
    const drifted = shapePhraseLesson({
      ...shoesModel,
      situations: [
        { setup: "You're on a phone call and the line crackles.", focus: "schlecht", focusTranslation: "bad", answer: "Die Verbindung ist schlecht.", translation: "The connection is bad." },
        { setup: "A friend is across a noisy room.", focus: "laut", focusTranslation: "loud", answer: "Es ist zu laut.", translation: "It's too loud." },
        { setup: "You're ordering online and you have to name what you need.", focus: "Ich brauche", focusTranslation: "I need", words: [{ text: "neue", translation: "new" }], answer: "Ich brauche neue Schuhe.", translation: "I need new shoes" },
      ],
    }, shoes);
    expect(drifted.ok).toBe(false);
    if (!drifted.ok) {
      expect(drifted.reason).toBe("situation_off_pattern");
      expect(drifted.detail).toContain("Es ist zu laut");
    }

    const piled = shapePhraseLesson({
      ...shoesModel,
      situations: shoesModel.situations.map((item, index) => index === 2
        ? { ...item, words: [{ text: "neue", translation: "new" }, { text: "heute", translation: "today" }] }
        : item),
    }, shoes);
    expect(piled.ok).toBe(true);
  });

  it("remembers the full lines and not the chunks", () => {
    const remembered = phrasesToRemember(lesson.segments, normalizeSpeakerNames({ teacher: "Mira" }), "de-DE");
    expect(remembered.map((item) => item.text)).toContain("Ich muss ein Paar Schuhe kaufen.");
    expect(remembered.map((item) => item.text)).toContain("Ich muss eine Jacke kaufen.");
    expect(remembered.map((item) => item.text)).not.toContain("Schuhe");
    expect(remembered.every((item) => item.speaker === "speakerA")).toBe(true);
  });
});
