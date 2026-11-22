import { describe, expect, it } from "vitest";
import {
  disambiguateTranslation,
  grammarPromptsAreClear,
  grammarTopics,
  selectGrammarTopic,
  shapeGrammarLesson,
} from "./grammar.js";
import { lessonDisplayText, speechSpans } from "./markup.js";
import { GeneratedLessonSchema, type LessonSegment } from "./schemas.js";
import { recallAnswersFollowPrompts } from "./pimsleur.js";
import { phrasesToRemember } from "./review.js";
import { DEFAULT_SPEAKER_NAMES } from "./speakers.js";

const thin = {
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
    { kind: "word", cue: "Say it out loud.", answer: "Ich bin", translation: "I am." },
    { kind: "word", cue: "How would you say you are?", answer: "Du bist", translation: "you are." },
    { kind: "phrase", cue: "Try saying I am tired.", answer: "Ich bin müde.", translation: "I am tired." },
    { kind: "sentence", cue: "How would you say We are ready?", answer: "Wir sind bereit.", translation: "We are ready." },
  ],
  checks: [
    { cue: "What form goes with ich?", answer: "bin." },
    { cue: "Where does the verb go?", answer: "In second position." },
  ],
  recombinations: [
    { cue: "How would you say I am ready?", answer: "Ich bin bereit.", translation: "I am ready." },
  ],
};

function lessonFor(id: string) {
  const topic = grammarTopics("de-DE", "A1").find((item) => item.id === id);
  if (!topic) throw new Error(id);
  const lesson = shapeGrammarLesson(thin, {
    nativeLanguage: "en-US",
    targetLanguage: "de-DE",
    level: "A1",
    topic,
    priorReviews: [{ text: "Danke.", translation: "Thanks." }],
  });
  if (!lesson) throw new Error(`no lesson for ${id}`);
  return GeneratedLessonSchema.parse(lesson);
}

function scriptOf(segments: LessonSegment[]): string {
  return segments.map((segment) => lessonDisplayText(segment.text)).join("\n");
}

function durationMs(segments: LessonSegment[]): number {
  return segments.reduce((total, segment) => {
    const words = lessonDisplayText(segment.text).trim().split(/\s+/u).filter(Boolean).length;
    return total + Math.max(700, Math.round((words / 2.4) * 1_000)) + (segment.pauseAfterMs ?? 0);
  }, 0);
}

function cues(segments: LessonSegment[]): string[] {
  return segments.filter((segment) => segment.pauseAfterMs).map((segment) => segment.text);
}

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
    expect(selectGrammarTopic({ language: "fr-FR", level: "A1", recentTopics: [] }).title).toBe("Present tense of être");
    expect(selectGrammarTopic({ language: "es-MX", level: "A1", recentTopics: [] }).title).toBe("Present tense of ser");
    expect(selectGrammarTopic({ language: "it-IT", level: "A1", recentTopics: [] }).title).toBe("Be and have");
    // Every catalog has enough topics per level to avoid repeating within a week of daily lessons.
    for (const language of ["de-DE", "es-ES", "fr-FR", "it-IT"] as const) {
      for (const level of ["A1", "A2", "B1", "B2", "C1"] as const) {
        expect(grammarTopics(language, level).length).toBeGreaterThanOrEqual(4);
        expect(new Set(grammarTopics(language, level).map((topic) => topic.id)).size).toBe(grammarTopics(language, level).length);
      }
    }
    const german = grammarTopics("de-DE", "A1");
    const oldest = selectGrammarTopic({
      language: "de-DE",
      level: "A1",
      recentTopics: [...german].reverse().map((topic) => topic.title),
    });
    expect(oldest.title).toBe(german[0]?.title);
    expect(grammarTopics("de-DE", "A2")[2]?.prerequisites).toContain("The Perfekt with haben");
    expect(german[0]?.insight).toMatch(/bin/);
    expect(german[0]?.forms).toContain("du bist");
    const next = german.find((topic) => topic.id === "de-sein-plural");
    expect(next?.forms).toContain("ihr seid");
    expect(next?.prerequisites).toContain(german[0]!.title);
  });

  it("names which you, she, or they the form is", () => {
    expect(disambiguateTranslation("you are", "Du bist müde.", "de-DE")).toMatch(/to a friend/);
    expect(disambiguateTranslation("you are", "Ihr seid müde.", "de-DE")).toMatch(/you all/);
    expect(disambiguateTranslation("you are", "Sie sind müde.", "de-DE")).toMatch(/formally/);
    expect(disambiguateTranslation("you are", "Sie ist müde.", "de-DE")).toMatch(/\bshe\b/);
    expect(disambiguateTranslation("you are", "sie sind müde.", "de-DE")).toMatch(/\bthey\b/);
    expect(disambiguateTranslation("you are", "tu es fatigué.", "fr-FR")).toMatch(/to a friend/);
    expect(disambiguateTranslation("you are", "vous êtes fatigué.", "fr-FR")).toMatch(/formally/);
    expect(disambiguateTranslation("you are", "tú estás.", "es-ES")).toMatch(/to a friend/);
    expect(disambiguateTranslation("you are", "vosotros estáis.", "es-ES")).toMatch(/you all/);
    expect(disambiguateTranslation("you are", "usted está.", "es-MX")).toMatch(/formally/);
    expect(disambiguateTranslation("you are", "ustedes están.", "es-MX")).toMatch(/you all/);
  });

  it("teaches singular sein with a warm-up, modeled examples, a breakdown, and spaced recall", () => {
    const parsed = lessonFor("de-sein");
    const script = scriptOf(parsed.segments.filter((item) => item.phase !== "warmup"));
    expect(script).not.toMatch(/Danke|second position|wir sind|ihr seid/iu);
    // A due phrase from an earlier lesson is recalled first, before the new rule.
    const warmup = parsed.segments.filter((item) => item.phase === "warmup");
    expect(warmup.map((item) => lessonDisplayText(item.text))).toContain("Danke.");
    expect(parsed.segments.findIndex((item) => item.phase === "warmup")).toBeLessThan(parsed.segments.findIndex((item) => item.phase === "hook"));
    expect(parsed.topic).toBe("Present tense of sein");
    expect(parsed.ruleId).toBe("de-sein");
    expect(parsed.segments.every((item) => item.speaker === "teacher")).toBe(true);
    for (const form of ["ich bin", "du bist", "er ist", "sie ist", "es ist"]) expect(script.toLowerCase()).toContain(form);
    expect(script).toContain('Ich bin müde.\nThat means "I am tired".');
    const notice = parsed.segments.findIndex((item) => item.phase === "notice" && item.kind === "drill");
    const rule = parsed.segments.findIndex((item) => item.phase === "rule");
    const anchor = parsed.segments.findIndex((item) => item.phase === "answer" && item.text === "Ich bin müde.");
    const later = parsed.segments.findIndex((item) => item.phase === "review" && item.text === "Ich bin müde.");
    expect(parsed.segments.slice(0, notice).filter((item) => item.kind === "example")).toHaveLength(4);
    expect(parsed.segments.filter((item) => item.phase === "breakdown").map((item) => lessonDisplayText(item.text)).join(" ")).toMatch(/word itself changes/);
    expect(rule).toBeGreaterThan(notice);
    expect(anchor).toBeGreaterThan(rule);
    expect(parsed.segments.slice(anchor + 1, later).some((item) => item.phase === "answer" && item.text === "Du bist müde.")).toBe(true);
    expect(parsed.segments.filter((item) => item.phase === "answer").length).toBeGreaterThanOrEqual(7);
    expect(parsed.segments.filter((item) => item.phase === "answer").map((item) => item.text)).toContain("Es ist bereit.");
    expect(parsed.segments.at(-1)?.phase).toBe("closing");
    expect(cues(parsed.segments).some((cue) => cue.includes("___"))).toBe(true);
    expect(grammarPromptsAreClear(parsed.segments)).toBe(true);
    expect(recallAnswersFollowPrompts(parsed.segments)).toBe(true);
    // This rough count leaves out the slower beginner voice and the gaps between clips,
    // which add about half a minute to a lesson that is five to eight minutes long.
    expect(durationMs(parsed.segments)).toBeGreaterThan(4.5 * 60_000);
    expect(durationMs(parsed.segments)).toBeLessThan(8 * 60_000);
    expect(phrasesToRemember(parsed.segments, DEFAULT_SPEAKER_NAMES, "de-DE").map((phrase) => phrase.text)).toContain("Ich bin müde.");
  });

  it("teaches the group and formal forms in distinct follow-up lessons", () => {
    const patterns = [
      ["de-sein", ["wir sind", "ihr seid", "sie sind"], "Sie sind zu Hause."],
      ["de-haben", ["wir haben", "ihr habt", "sie haben"], "Sie haben Zeit."],
      ["de-present", ["wir machen", "ihr macht", "sie machen"], "Sie machen das."],
    ] as const;
    for (const [id, forms, formal] of patterns) {
      const single = scriptOf(lessonFor(id).segments).toLowerCase();
      const group = lessonFor(`${id}-plural`);
      for (const form of forms) {
        expect(single).not.toContain(form);
        expect(scriptOf(group.segments).toLowerCase()).toContain(form);
      }
      expect(group.segments.find((item) => item.kind === "example" && item.text === formal)?.translation).toContain("formally");
      expect(group.segments.filter((item) => item.phase === "answer").length).toBeGreaterThanOrEqual(6);
      expect(grammarPromptsAreClear(group.segments)).toBe(true);
    }
  });

  it("models the hook once and speaks German stems and endings in German", () => {
    const { segments } = lessonFor("de-present");
    const hook = segments.find((segment) => segment.kind === "example" && segment.phase === "hook")!;
    expect(segments.filter((segment) => segment.kind === "example" && segment.text === hook.text)).toHaveLength(1);
    expect(segments[segments.indexOf(hook) + 1]?.text).toBe('That means "I make coffee".');
    const stemLine = segments.find((segment) => segment.phase === "rule")!;
    const spans = speechSpans(stemLine.text, stemLine.language);
    expect(spans).toContainEqual({ language: "de-DE", text: expect.stringMatching(/^mach-/u) });
    expect(spans.filter((span) => span.language === "en-US").map((span) => span.text).join("")).not.toContain("mach-");
    const check = segments.find((segment) => segment.phase === "check" && segment.kind === "explanation")!;
    expect(speechSpans(check.text, check.language)).toEqual([{ language: "de-DE", text: "st. du machst." }]);
    const ending = segments.find((segment) => segment.phase === "usage")!;
    expect(speechSpans(ending.text, ending.language)).toContainEqual({ language: "de-DE", text: "-e, -st, -t." });
  });

  it("repairs untagged grammar terms and affixes in a generated lesson", () => {
    const topic = grammarTopics("it-IT", "A1").find((item) => item.id === "g-present")!;
    const lesson = shapeGrammarLesson({
      title: "Present tense of parler",
      summary: "Use parler in the present tense.",
      hook: { text: "Je parle.", translation: "I speak." },
      examples: [
        { text: "je parle!", translation: "I speak." },
        { text: "Tu parles.", translation: "You speak." },
        { text: "Il parle.", translation: "He speaks." },
      ],
      rule: "Keep parl- and add -e. The infinitive parler uses the same stem.",
      mnemonic: "Keep parl-.",
      targetTerms: ["parler"],
      drills: [
        { answer: "Je parle.", translation: "I speak." },
        { answer: "Je parle!", translation: "I speak." },
        { answer: "Tu parles.", translation: "You speak." },
        { answer: "Il parle.", translation: "He speaks." },
        { answer: "Nous parlons.", translation: "We speak." },
      ],
    }, { topic, level: "A1", nativeLanguage: "en-US", targetLanguage: "fr-FR" });
    const segments = GeneratedLessonSchema.parse(lesson).segments;
    const models = segments.filter((segment) => segment.kind === "example");
    // Three distinct models, then a fourth drill that is shown as a worked example before it is asked.
    expect(models.map((segment) => segment.text)).toEqual(["Je parle.", "Tu parles.", "Il parle.", "Nous parlons."]);
    expect(models.at(-1)?.phase).toBe("worked");
    expect(segments.filter((segment) => segment.phase === "answer").map((segment) => segment.text))
      .toEqual(["Je parle.", "Tu parles.", "Il parle.", "Nous parlons."]);
    const rule = segments.find((segment) => lessonDisplayText(segment.text).startsWith("Keep parl- and add"))!;
    expect(speechSpans(rule.text, rule.language).filter((span) => span.language === "fr-FR").map((span) => span.text.trim()))
      .toEqual(["parl-", "-e", "parler"]);
  });

  it("scales thinking time with the level and uses every drill and application the model gives", () => {
    const topic = grammarTopics("it-IT", "A1").find((item) => item.id === "g-present")!;
    const examples = [
      { text: "Je parle.", translation: "I speak." },
      { text: "Tu parles.", translation: "You speak." },
      { text: "Elle parle.", translation: "She speaks." },
    ];
    const source = {
      title: "Saying who is speaking",
      goal: "Say who is speaking in French.",
      hook: examples[0],
      examples: examples.slice(1),
      noticeCue: "Listen for what changes when you talk to a friend.",
      notice: "You hear the subject change.",
      rule: "Use the matching subject and verb form for each person.",
      usageTip: "With a friend, use the informal form. This extra detail goes beyond the lesson.",
      drills: [...examples, { text: "Il parle.", translation: "He speaks." }, { text: "On parle.", translation: "People speak." }],
      recombinations: [
        { text: "Je parle avec elle.", translation: "I speak with her." },
        { text: "Je parle avec lui.", translation: "I speak with him." },
      ],
    };
    const build = (level: "A1" | "C1") => shapeGrammarLesson(source, {
      topic, level, nativeLanguage: "en-US", targetLanguage: "fr-FR",
    })!.segments;
    const a1 = build("A1");
    const c1 = build("C1");
    expect(a1[0]?.text).toBe(source.goal);
    expect(a1.filter((part) => part.phase === "answer")).toHaveLength(5);
    expect(c1.filter((part) => part.phase === "answer")).toHaveLength(5);
    expect(a1.find((part) => part.phase === "practice")?.pauseAfterMs).toBeGreaterThan(c1.find((part) => part.phase === "practice")!.pauseAfterMs!);
    expect(a1.find((part) => part.phase === "notice" && part.kind === "drill")?.pauseAfterMs)
      .toBeGreaterThan(c1.find((part) => part.phase === "notice" && part.kind === "drill")!.pauseAfterMs!);
    expect(a1.filter((part) => part.phase === "usage").map((part) => part.text)).toEqual(["With a friend, use the informal form."]);
    expect(c1.filter((part) => part.phase === "recombine" && part.language === "fr-FR")).toHaveLength(2);
    expect(grammarPromptsAreClear(a1) && grammarPromptsAreClear(c1)).toBe(true);
  });
});
