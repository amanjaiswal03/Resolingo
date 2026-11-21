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
    expect(selectGrammarTopic({ language: "fr-FR", level: "A1", recentTopics: [] }).title).toBe("Be and have");
    const german = grammarTopics("de-DE", "A1");
    const oldest = selectGrammarTopic({
      language: "de-DE",
      level: "A1",
      recentTopics: [...german].reverse().map((topic) => topic.title),
    });
    expect(oldest.title).toBe(german[0]?.title);
    expect(grammarTopics("de-DE", "A2")[2]?.prerequisites).toContain("The Perfekt with haben");
    expect(german[0]?.insight).toMatch(/bin/);
    expect(german[0]?.forms).toContain("ihr seid");
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

  it("teaches the whole sein paradigm in one voice, without a second rule", () => {
    const parsed = lessonFor("de-sein");
    const script = scriptOf(parsed.segments);
    const spoken = script.toLocaleLowerCase();
    expect(script).not.toContain("Danke");
    expect(script).not.toContain("Thanks");
    expect(parsed.segments.some((segment) => segment.phase === "warmup")).toBe(false);
    expect(parsed.topic).toBe("Present tense of sein");
    expect(parsed.ruleId).toBe("de-sein");
    expect(parsed.segments.every((segment) => segment.speaker === "teacher")).toBe(true);
    for (const form of ["ich bin", "du bist", "er ist", "sie ist", "es ist", "wir sind", "ihr seid", "sie sind", "sie sind"]) {
      expect(spoken).toContain(form);
    }
    expect(script).toContain("Sie sind");
    const singularRule = parsed.segments.find((segment) => segment.phase === "rule" && segment.text.includes("ich bin"));
    expect(singularRule?.text).toMatch(/du bist/);
    expect(singularRule?.text).toMatch(/sie ist/);
    expect(singularRule?.text.toLocaleLowerCase()).not.toMatch(/second position|word order/);
    const pluralAt = parsed.segments.findIndex((segment) => segment.text.includes("ihr seid"));
    const singularAt = parsed.segments.findIndex((segment) => segment.phase === "rule" && segment.text.includes("du bist"));
    expect(pluralAt).toBeGreaterThan(singularAt);
    const notices = parsed.segments.filter((segment) => segment.phase === "notice" && !segment.pauseAfterMs).map((segment) => segment.text);
    expect(notices.join(" ").toLocaleLowerCase()).not.toContain("ending changes");
    expect(notices.some((line) => /bin/.test(line) && /bist/.test(line))).toBe(true);
    expect(notices.some((line) => /she/.test(line) && /they/.test(line))).toBe(true);
    expect(spoken).not.toContain("second position");
    expect(spoken).not.toContain("where does the verb");
    expect(script).toContain('Ich bin müde.\nThat means "I am tired".');
    expect(lessonDisplayText(parsed.segments[0]?.text ?? "")).toBe("Today we'll learn how to use sein, to be.");
    expect(parsed.segments.some((segment) => segment.phase === "summary" && lessonDisplayText(segment.text).startsWith("Here is sein"))).toBe(true);
    expect(parsed.segments.at(-1)?.text).toMatch(/Nice work/);
    expect(parsed.segments.at(-1)?.text).toMatch(/out loud/);
    expect(grammarPromptsAreClear(parsed.segments)).toBe(true);
    const prompts = cues(parsed.segments);
    const counts = new Map<string, number>();
    for (const cue of prompts) counts.set(cue, (counts.get(cue) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    expect(prompts.some((cue) => /to a friend/i.test(cue))).toBe(true);
    expect(prompts.some((cue) => /you all/i.test(cue))).toBe(true);
    expect(prompts.some((cue) => /formally/i.test(cue))).toBe(true);
    expect(prompts.some((cue) => /\bshe\b/i.test(cue))).toBe(true);
    expect(prompts.some((cue) => /\bthey\b/i.test(cue))).toBe(true);
    expect(prompts.some((cue) => cue.includes("___"))).toBe(true);
    expect(prompts.some((cue) => /change |now make it|put this in the/i.test(cue))).toBe(true);
    expect(prompts.some((cue) => /which form/i.test(cue))).toBe(true);
    expect(prompts.filter((cue) => cue.startsWith("How would you say")).length).toBeLessThan(prompts.length / 2);
    expect(parsed.segments.length).toBeGreaterThanOrEqual(80);
    expect(parsed.segments.length).toBeLessThanOrEqual(120);
    const minutes = durationMs(parsed.segments) / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(8);
    expect(minutes).toBeLessThanOrEqual(12);
    const remembered = phrasesToRemember(parsed.segments, DEFAULT_SPEAKER_NAMES, "de-DE");
    expect(remembered.map((phrase) => phrase.text)).toContain("Ich bin");
    expect(remembered.every((phrase) => phrase.speaker === "speakerA")).toBe(true);
  });

  it("covers every haben and regular-present form", () => {
    const haben = scriptOf(lessonFor("de-haben").segments).toLocaleLowerCase();
    for (const form of ["ich habe", "du hast", "er hat", "sie hat", "es hat", "wir haben", "ihr habt", "sie haben"]) {
      expect(haben).toContain(form);
    }
    expect(scriptOf(lessonFor("de-haben").segments)).toContain("Sie haben");
    const regular = lessonFor("de-present");
    const text = scriptOf(regular.segments);
    const lower = text.toLocaleLowerCase();
    for (const form of ["ich mache", "du machst", "er macht", "wir machen", "ihr macht", "sie machen"]) {
      expect(lower).toContain(form);
    }
    expect(text).toContain("Sie machen");
    expect(lower).not.toContain("second position");
    for (const lesson of [lessonFor("de-haben"), regular]) {
      const prompts = cues(lesson.segments);
      const counts = new Map<string, number>();
      for (const cue of prompts) counts.set(cue, (counts.get(cue) ?? 0) + 1);
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
      expect(prompts.some((cue) => /to a friend/i.test(cue))).toBe(true);
      expect(prompts.some((cue) => /you all/i.test(cue))).toBe(true);
      expect(prompts.some((cue) => /formally/i.test(cue))).toBe(true);
      expect(lesson.segments.length).toBeLessThanOrEqual(120);
    }
  });

  it("models each hook once and speaks stems, irregular forms, and endings in German", () => {
    for (const [id, stem] of [["de-haben", "hab-"], ["de-present", "mach-"]] as const) {
      const { segments } = lessonFor(id);
      const hook = segments.find((segment) => segment.kind === "example" && segment.phase === "hook")!;
      expect(segments.filter((segment) => segment.kind === "example" && segment.text === hook.text)).toHaveLength(1);
      expect(segments[segments.indexOf(hook) + 1]?.text).toBe(`That means "${hook.translation!.slice(0, -1)}".`);
      const stemLine = segments.find((segment) => lessonDisplayText(segment.text).includes(stem))!;
      const spans = speechSpans(stemLine.text, stemLine.language);
      expect(spans).toContainEqual({ language: "de-DE", text: stem });
      expect(spans.filter((span) => span.language === "en-US").map((span) => span.text).join("")).not.toContain(stem);
    }
    const script = lessonFor("de-present").segments;
    const check = script.find((segment) => segment.phase === "check" && !segment.pauseAfterMs)!;
    expect(speechSpans(check.text, check.language)).toEqual([{ language: "de-DE", text: "st. du machst." }]);
    const ending = script.find((segment) => lessonDisplayText(segment.text).startsWith("Hold onto the endings"))!;
    expect(speechSpans(ending.text, ending.language).at(-1)).toMatchObject({ language: "de-DE", text: "e, st, t, en, t, en." });
  });

  it("repairs untagged grammar terms and affixes in a generated lesson", () => {
    const topic = grammarTopics("fr-FR", "A1").find((item) => item.id === "g-present")!;
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
    expect(models.map((segment) => segment.text)).toEqual(["Je parle.", "Tu parles.", "Il parle."]);
    expect(segments.filter((segment) => segment.phase === "answer").map((segment) => segment.text))
      .toEqual(["Je parle.", "Tu parles.", "Il parle.", "Nous parlons."]);
    const rule = segments.find((segment) => lessonDisplayText(segment.text).startsWith("Keep parl- and add"))!;
    expect(speechSpans(rule.text, rule.language).filter((span) => span.language === "fr-FR").map((span) => span.text.trim()))
      .toEqual(["parl-", "-e", "parler"]);
  });
});
