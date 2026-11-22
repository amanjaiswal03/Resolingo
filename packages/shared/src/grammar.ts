import type { LanguageId } from "./languages.js";
import type { CefrLevel } from "./schemas.js";
import { applyTargetVoices, lessonDisplayText, repairMarkup, speechSpans } from "./markup.js";
import { conversationPacing } from "./pimsleur.js";
import { segmentWords, splitSentences } from "./segment.js";
import { speakingPauseMs } from "./speaking-timing.js";
import type { LessonSegment } from "./schemas.js";
import { normalizeSpeakerNames, type SpeakerNames } from "./speakers.js";
import { grammarMeaning, isEnglish, line, markAddress, mentionsAddress, template, type TeachingKey } from "./teaching.js";

export const grammarPacing = {
  A1: { examples: 3, drills: 3, words: 10, noticeMs: 5_000 },
  A2: { examples: 3, drills: 4, words: 13, noticeMs: 4_500 },
  B1: { examples: 3, drills: 4, words: 18, noticeMs: 4_000 },
  B2: { examples: 3, drills: 5, words: 23, noticeMs: 3_750 },
  C1: { examples: 3, drills: 5, words: 28, noticeMs: 3_500 },
} as const satisfies Record<CefrLevel, { examples: number; drills: number; words: number; noticeMs: number }>;

export type GrammarTopic = {
  id: string;
  title: string;
  level: CefrLevel;
  focus: string;
  prerequisites: string[];
  /** What the learner should actually notice. Wrong model copy is replaced with this. */
  insight?: string;
  /** Every form this lesson is responsible for. */
  forms?: string;
  /** The mistake this lesson should head off. */
  pitfall?: string;
};

const GERMAN: Record<CefrLevel, Array<Omit<GrammarTopic, "level" | "prerequisites">>> = {
  A1: [
    { id: "de-sein", title: "Present tense of sein", focus: "say how you, a friend, or one other person is with ich bin, du bist, and ist" },
    { id: "de-haben", title: "Present tense of haben", focus: "say what you, a friend, or one other person has with ich habe, du hast, and hat" },
    { id: "de-gender", title: "Noun gender and der, die, das", focus: "the article as part of the noun, with a few reliable ending cues" },
    { id: "de-present", title: "Regular verbs in the present tense", focus: "the regular singular endings -e, -st, and -t, used in short sentences" },
    { id: "de-sein-plural", title: "Plural and formal forms of sein", focus: "describe a group or speak formally with wir sind, ihr seid, sie sind, and Sie sind" },
    { id: "de-haben-plural", title: "Plural and formal forms of haben", focus: "say what a group has, or speak formally, with wir haben, ihr habt, sie haben, and Sie haben" },
    { id: "de-present-plural", title: "Regular present tense for groups and formal address", focus: "use the endings -en and -t with wir, ihr, sie, and formal Sie" },
    { id: "de-v2", title: "The verb in second position", focus: "the conjugated verb stays second when something else starts the sentence" },
    { id: "de-negation", title: "Negation with nicht and kein", focus: "kein for a noun with no article, nicht for the rest" },
    { id: "de-questions", title: "Yes-no questions", focus: "the verb moves first when you ask a yes-no question" },
    { id: "de-accusative", title: "Accusative articles", focus: "den and einen for masculine direct objects, die and das unchanged" },
  ],
  A2: [
    { id: "de-perfekt-haben", title: "The Perfekt with haben", focus: "habe or hast plus the participle, for most verbs" },
    { id: "de-perfekt-sein", title: "The Perfekt with sein", focus: "bin or bist plus the participle for movement and change of state" },
    { id: "de-modals", title: "Modal verbs", focus: "können, müssen, and wollen with the main verb at the end" },
    { id: "de-dative", title: "The dative case", focus: "dem, der, and mir or dir for the person something is given to" },
    { id: "de-separable", title: "Separable verbs", focus: "the prefix goes to the end in a main clause" },
    { id: "de-possessive", title: "Possessive articles", focus: "mein, dein, and ihr agreeing with the noun" },
    { id: "de-comparative", title: "Comparatives", focus: "the -er ending and als" },
    { id: "de-prepositions", title: "Two-way prepositions", focus: "in, an, and auf with accusative for direction and dative for location" },
  ],
  B1: [
    { id: "de-weil", title: "Clauses with weil", focus: "weil sends the conjugated verb to the end" },
    { id: "de-verb-final", title: "Verb-final word order", focus: "dass and weil both leave the verb last" },
    { id: "de-prateritum", title: "The Präteritum of sein, haben, and modals", focus: "war, hatte, and konnte in narration" },
    { id: "de-adjective", title: "Adjective endings after der-words", focus: "the ending that follows der, die, and das" },
    { id: "de-relative", title: "Relative clauses", focus: "der, die, das as a relative pronoun, with the verb at the end" },
    { id: "de-reflexive", title: "Reflexive verbs", focus: "mich and mir with verbs like sich freuen" },
    { id: "de-wurde", title: "The würde conditional", focus: "würde plus the infinitive for a polite or hypothetical wish" },
    { id: "de-passive", title: "The passive with werden", focus: "wird plus the participle, and the agent with von" },
  ],
  B2: [
    { id: "de-konjunktiv-ii", title: "The Konjunktiv II", focus: "wäre, hätte, and würde for unreal situations" },
    { id: "de-passive-modal", title: "The passive with a modal", focus: "muss gemacht werden and the verb order" },
    { id: "de-da-compounds", title: "da- and wo-compounds", focus: "darüber and worüber instead of repeating a preposition plus a thing" },
    { id: "de-endings", title: "Adjective endings in full", focus: "the ending after a der-word, an ein-word, and no article" },
    { id: "de-infinitive-noun", title: "Nominalized infinitives", focus: "das Essen and similar nouns from verbs" },
    { id: "de-reported", title: "Reported speech with Konjunktiv I", focus: "sei and habe when reporting what someone said" },
    { id: "de-participle", title: "Participle clauses", focus: "a participle phrase in front of the noun" },
    { id: "de-connectors", title: "Connectors and word order", focus: "obwohl, trotzdem, and which ones send the verb last" },
  ],
  C1: [
    { id: "de-modal-subjective", title: "Subjective meaning of modal verbs", focus: "dürfte, müsste, and soll for inference and hearsay" },
    { id: "de-nominal-style", title: "Nominal style", focus: "packing a clause into a noun phrase in formal German" },
    { id: "de-concession", title: "Concessive clauses", focus: "wenn auch and obgleich with the verb at the end" },
    { id: "de-hypothetical", title: "Hypothetical past", focus: "hätte gemacht and wäre gegangen for a past that did not happen" },
  ],
};

const GENERIC: Record<CefrLevel, Array<{ id: string; title: string; focus: string }>> = {
  A1: [
    { id: "g-be-have", title: "Be and have", focus: "choose one everyday pattern for identifying a person or saying what someone has, and practice just that use" },
    { id: "g-articles", title: "Articles or noun class", focus: "how a noun is marked, and one reliable cue" },
    { id: "g-present", title: "Present tense of regular verbs", focus: "the personal endings, used rather than listed" },
    { id: "g-negation", title: "Negation", focus: "the usual way to negate a verb and a noun" },
    { id: "g-questions", title: "Questions", focus: "yes-no questions and one question word" },
    { id: "g-pronouns", title: "Subject pronouns", focus: "the pronouns with the matching verb form" },
  ],
  A2: [
    { id: "g-past", title: "A common past tense", focus: "one past form the learner can use for finished events" },
    { id: "g-modals", title: "Modal verbs", focus: "can, must, and want with the main verb" },
    { id: "g-objects", title: "Object pronouns", focus: "the pronoun that replaces a thing already mentioned" },
    { id: "g-comparative", title: "Comparatives", focus: "comparing two things in a full sentence" },
    { id: "g-prepositions", title: "Frequent prepositions", focus: "three high-frequency prepositions and the form they require" },
  ],
  B1: [
    { id: "g-subordinate", title: "Subordinate clauses", focus: "one conjunction and where the verb goes" },
    { id: "g-relative", title: "Relative clauses", focus: "adding information about a noun" },
    { id: "g-conditional", title: "A real conditional", focus: "if-clauses the learner can actually say" },
    { id: "g-past-contrast", title: "Two past forms", focus: "when to choose one past over the other" },
  ],
  B2: [
    { id: "g-passive", title: "The passive", focus: "removing the agent and keeping the action" },
    { id: "g-reported", title: "Reported speech", focus: "telling someone what another person said" },
    { id: "g-connectors", title: "Complex connectors", focus: "two connectors and the word order each one requires" },
  ],
  C1: [
    { id: "g-mood", title: "Nuanced mood", focus: "one form that softens, hypothesizes, or reports" },
    { id: "g-formal", title: "Formal clause structure", focus: "packing information the way careful writing does" },
  ],
};

function withPrerequisites(rows: Array<Omit<GrammarTopic, "level" | "prerequisites">>, level: CefrLevel): GrammarTopic[] {
  return rows.map((row, index) => {
    const plural = row.id.endsWith("-plural");
    const paradigm = PARADIGMS[row.id.replace(/-plural$/u, "")];
    return {
      ...row,
      level,
      prerequisites: rows.slice(0, index).map((earlier) => earlier.title),
      ...(paradigm ? { forms: plural ? paradigm.forms.plural : paradigm.forms.singular } : {}),
      ...(paradigm && !plural ? { insight: lessonDisplayText(paradigm.insight) } : {}),
    };
  });
}

export function grammarTopics(language: LanguageId, level: CefrLevel): GrammarTopic[] {
  const rows = (language.startsWith("de") ? GERMAN[level] : GENERIC[level]) ?? GENERIC.A1;
  return withPrerequisites(rows, level);
}

/** The next point in the level's sequence that this learner has not just studied. */
export function selectGrammarTopic(input: {
  language: LanguageId;
  level: CefrLevel;
  recentTopics: readonly string[];
}): GrammarTopic {
  const catalog = grammarTopics(input.language, input.level);
  const recent = input.recentTopics.map((topic) => topic.trim().toLocaleLowerCase());
  const seen = new Set(recent);
  const fresh = catalog.find((topic) => !seen.has(topic.id.toLocaleLowerCase()) && !seen.has(topic.title.toLocaleLowerCase()));
  if (fresh) return fresh;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const again = catalog.find((topic) => topic.title.toLocaleLowerCase() === recent[index] || topic.id.toLocaleLowerCase() === recent[index]);
    if (again) return again;
  }
  return catalog[0] ?? withPrerequisites(GENERIC.A1, "A1")[0]!;
}

type Example = { text: string; translation: string };
type DrillKind = "word" | "phrase" | "sentence";
type Drill = { cue: string; answer: string; translation: string; source?: string; kind?: DrillKind };
type Address = "friend" | "all" | "formal" | "she" | "they";

/**
 * The PR #17 speak-prompt pool, each one still naming the meaning.
 * A cue with no meaning ("Say it out loud.") is not usable on its own.
 */
const SPEAK_KEYS = ["how", "can", "try", "give", "turn", "loud", "nowSay", "whatFor"] as const satisfies readonly TeachingKey[];

const MAX_IDENTICAL_CUES = 2;

const DRILL_ORDER: Record<DrillKind, number> = { word: 0, phrase: 1, sentence: 2 };
type RuleCheck = { cue: string; answer: string };

export type GrammarSource = {
  title: string;
  topic: GrammarTopic;
  summary: string;
  teacherName: string;
  hook: Example;
  examples: Example[];
  notice: string;
  noticeCue?: string;
  rule: string;
  mnemonic: string;
  targetTerms?: string[];
  usageTip?: string;
  welcome?: string;
  closing?: string;
  drills: Drill[];
  checks: RuleCheck[];
  recombinations: Drill[];
};

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function meaningOf(value: string): string {
  return value.replace(/[.!?？。]+$/u, "").trim();
}

function spokenKey(text: string): string {
  return meaningOf(lessonDisplayText(text)).normalize("NFC").toLocaleLowerCase();
}

function applyAddress(meaning: string, kind: Address): string {
  const bare = meaning.replace(/[.!?]+$/u, "").trim();
  if (kind === "all") return bare.replace(/\byou\b/i, "you all");
  if (kind === "she") return bare.replace(/\byou\b/i, "she").replace(/\bare\b/i, "is");
  if (kind === "they") return bare.replace(/\byou\b/i, "they");
  if (kind === "formal") return `${bare}, formally`;
  return `${bare}, to a friend`;
}

/** Name which "you" (or she/they) the target form is, when the teaching-language cue would otherwise be ambiguous. */
export function disambiguateTranslation(
  translation: string,
  answer: string,
  language: string,
  nativeLanguage: LanguageId = "en-US",
): string {
  if (!isEnglish(nativeLanguage)) return disambiguateNative(translation, answer, language, nativeLanguage);
  const meaning = translation.trim();
  if (!meaning || /\b(to a friend|you all|formally)\b/i.test(meaning)) return meaningOf(meaning);
  const lower = answer.toLocaleLowerCase();
  const asksYou = /\byou\b/i.test(meaning);
  if (language.startsWith("fr")) {
    if (/\btu\b/i.test(answer) && asksYou) return applyAddress(meaning, "friend");
    if (/\bvous\b/i.test(answer) && asksYou) return `${meaningOf(meaning)}, formally or you all`;
    return meaningOf(meaning);
  }
  if (language.startsWith("es")) {
    if (/\bustedes\b/i.test(answer) && asksYou) return applyAddress(meaning, "all");
    if (/\busted\b/i.test(answer) && asksYou) return applyAddress(meaning, "formal");
    if (/\bvosotros\b/i.test(lower) && asksYou) return applyAddress(meaning, "all");
    if (/(?:^|[^a-z])t[uú](?:[^a-z]|$)/i.test(answer) && asksYou) return applyAddress(meaning, "friend");
    return meaningOf(meaning);
  }
  if (!language.startsWith("de") || !asksYou) return meaningOf(meaning);
  const plural = /\b(sind|haben|machen|seid|habt)\b/.test(lower);
  if (/\bihr\b/.test(lower) || /\bseid\b/.test(lower) || /\bhabt\b/.test(lower)) return applyAddress(meaning, "all");
  if (/^Sie\b/.test(answer.trim()) && plural) return applyAddress(meaning, "formal");
  if (/\bsie\b/.test(lower) && plural) return applyAddress(meaning, "they");
  if (/\bdu\b/.test(lower) || /\b(bist|hast|machst)\b/.test(lower)) return applyAddress(meaning, "friend");
  if (/\b(ist|hat|macht)\b/.test(lower)) return applyAddress(meaning, "she");
  return meaningOf(meaning);
}

function addressKind(answer: string, language: string): "friend" | "all" | "formal" | "she" | "they" | "vous" | null {
  const lower = answer.toLocaleLowerCase();
  if (language.startsWith("fr")) {
    if (/\btu\b/i.test(answer)) return "friend";
    if (/\bvous\b/i.test(answer)) return "vous";
    return null;
  }
  if (language.startsWith("es")) {
    if (/\bustedes\b/i.test(answer)) return "all";
    if (/\busted\b/i.test(answer)) return "formal";
    if (/\bvosotros\b/i.test(lower)) return "all";
    if (/(?:^|[^a-z])t[uú](?:[^a-z]|$)/i.test(answer)) return "friend";
    return null;
  }
  if (!language.startsWith("de")) return null;
  const plural = /\b(sind|haben|machen|seid|habt)\b/.test(lower);
  if (/\bihr\b/.test(lower) || /\bseid\b/.test(lower) || /\bhabt\b/.test(lower)) return "all";
  if (/^Sie\b/.test(answer.trim()) && plural) return "formal";
  if (/\bsie\b/.test(lower) && plural) return "they";
  if (/\bdu\b/.test(lower) || /\b(bist|hast|machst)\b/.test(lower)) return "friend";
  if (/\b(ist|hat|macht)\b/.test(lower)) return "she";
  return null;
}

function disambiguateNative(translation: string, answer: string, language: string, nativeLanguage: LanguageId): string {
  const meaning = translation.trim();
  if (!meaning || mentionsAddress(meaning, nativeLanguage)) return meaningOf(meaning);
  const kind = addressKind(answer, language);
  if (!kind) return meaningOf(meaning);
  return markAddress(meaning, kind, nativeLanguage);
}

function exampleFrom(value: unknown): Example | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = textOf(record.text ?? record.answer ?? record.target);
  const translation = textOf(record.translation ?? record.meaning ?? record.native);
  if (!text || !translation) return null;
  return { text: text.slice(0, 240), translation: translation.slice(0, 240) };
}

function drillFrom(value: unknown): Drill | null {
  const example = exampleFrom(value);
  if (!example) return null;
  const record = value as Record<string, unknown>;
  const cue = textOf(record.cue ?? record.prompt ?? record.instruction);
  const source = textOf(record.source);
  const kind = record.kind === "word" || record.kind === "phrase" || record.kind === "sentence" ? record.kind : undefined;
  return { cue, answer: example.text, translation: example.translation, ...(source ? { source } : {}), ...(kind ? { kind } : {}) };
}

/** A cue either names the answer's meaning or gives a transformation plus its source sentence. */
export function drillCue(drill: Drill, teaching: LanguageId = "en-US"): string {
  const meaning = meaningOf(drill.translation);
  const cue = drill.cue.trim();
  const citesMeaning = meaning.length >= 2 && cue.toLocaleLowerCase().includes(meaning.toLocaleLowerCase());
  const source = drill.source ?? "";
  const transforms = source.length > 0
    && cue.includes(source)
    && source.trim() !== drill.answer.trim()
    && /make|change|put|turn|negative|question|plural|past|formal|without|now/i.test(cue);
  if (citesMeaning || transforms) return cue.slice(0, 280);
  return line(teaching, "how", { translation: meaning });
}

function uniqueExamples(items: Example[], limit: number): Example[] {
  const seen = new Set<string>();
  const kept: Example[] = [];
  for (const item of items) {
    const key = spokenKey(item.text);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
    if (kept.length >= limit) break;
  }
  return kept;
}

function shortTeachingLine(value: unknown): string | undefined {
  const sentence = splitSentences(textOf(value))[0];
  return sentence && sentence.length <= 240 ? sentence : undefined;
}

function fitsGrammarExample(text: string, language: LanguageId, limit: number): boolean {
  const words = segmentWords(lessonDisplayText(text), language).length;
  return words > 0 && words <= limit;
}

export function parseGrammarSource(
  value: unknown, topic: GrammarTopic, level: CefrLevel, target: LanguageId,
): GrammarSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pacing = grammarPacing[level];
  const examples = uniqueExamples(
    [record.hook, ...(Array.isArray(record.examples) ? record.examples : [])]
      .map(exampleFrom).filter((item): item is Example => Boolean(item && fitsGrammarExample(item.text, target, pacing.words))),
    pacing.examples,
  );
  const hook = examples[0];
  if (!hook || examples.length < 2) return null;

  const practiceFrom = (items: unknown) => (Array.isArray(items) ? items : [])
    .map(drillFrom)
    .filter((item): item is Drill => Boolean(item && fitsGrammarExample(item.answer, target, pacing.words)
      && (!item.source || fitsGrammarExample(item.source, target, pacing.words))));
  const drills = practiceFrom(record.drills).sort((left, right) => DRILL_ORDER[left.kind ?? "phrase"] - DRILL_ORDER[right.kind ?? "phrase"]);
  const recombinations = practiceFrom(record.recombinations).slice(0, 1);
  const checks = (Array.isArray(record.checks) ? record.checks : [])
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const cue = shortTeachingLine(row.cue ?? row.prompt);
      const answer = shortTeachingLine(row.answer);
      return cue && answer ? [{ cue, answer }] : [];
    }).slice(0, 1);

  const rule = textOf(record.rule);
  if (!rule || rule.length > 420 || splitSentences(rule).length > 3) return null;
  const notice = shortTeachingLine(record.notice) ?? rule;
  const noticeCue = shortTeachingLine(record.noticeCue);
  const welcome = shortTeachingLine(record.goal);
  const closing = shortTeachingLine(record.closing);
  const usageTip = shortTeachingLine(record.usageTip) ?? (level === "B2" || level === "C1" ? shortTeachingLine(record.exception) : undefined);
  const targetTerms = Array.isArray(record.targetTerms)
    ? record.targetTerms.map(textOf).filter((term) => term.length > 0 && term.length <= 80).slice(0, 80)
    : [];
  const names = normalizeSpeakerNames(record.speakerNames);
  return {
    title: (textOf(record.title) || topic.title).slice(0, 90),
    topic,
    summary: (textOf(record.summary) || topic.focus).slice(0, 280),
    teacherName: names.teacher,
    hook,
    examples: examples.slice(1),
    notice,
    ...(noticeCue ? { noticeCue } : {}),
    ...(welcome ? { welcome } : {}),
    ...(closing ? { closing } : {}),
    rule,
    mnemonic: shortTeachingLine(record.mnemonic) ?? "",
    ...(targetTerms.length > 0 ? { targetTerms } : {}),
    ...(usageTip ? { usageTip } : {}),
    drills,
    checks,
    recombinations,
  };
}

function exampleMeaning(example: Example, teaching: LanguageId): string {
  return line(teaching, "thatMeans", { meaning: meaningOf(example.translation) });
}

function inLanguage(language: LanguageId, text: string): string {
  return `[[lang:${language}]]${text}[[/lang]]`;
}

function german(text: string): string {
  return inLanguage("de-DE", text);
}

type Practice = {
  answer: string;
  translation: string;
  half: "singular" | "plural";
} & ({ mode: "transform"; source: string; from: string; to: string } | { mode: "gap"; gap: string });

type Paradigm = {
  title: string;
  welcome: string;
  insight: string;
  forms: { singular: string; plural: string };
  singularRule: string;
  pluralRule: string;
  mnemonic: string;
  closing: string;
  hook: Example;
  singularExamples: Example[];
  pluralExamples: Example[];
  practice: Practice[];
  checks: Array<{ cue: string; answer: string }>;
};

function transform(half: Practice["half"], from: string, to: string, source: string, answer: string, translation: string): Practice {
  return { half, mode: "transform", from, to, source, answer, translation };
}
function gap(half: Practice["half"], missing: string, answer: string, translation: string): Practice {
  return { half, mode: "gap", gap: missing, answer, translation };
}


const SEIN: Paradigm = {
  title: "Sein, to be",
  welcome: `Today we'll learn how to use ${german("sein")}, to be.`,
  insight: `${german("Sein")} does not add a regular ending. The word itself changes: ${german("bin")} for ${german("ich")}, ${german("bist")} for ${german("du")}, and ${german("ist")} for ${german("er, sie")} and ${german("es")}.`,
  forms: { singular: "ich bin, du bist, er ist, sie ist, es ist", plural: "wir sind, ihr seid, sie sind, Sie sind" },
  singularRule: `For one person: ${german("ich bin, du bist")} when you talk to a friend, and ${german("sie ist")}. ${german("er ist")} and ${german("es ist")} use that same ${german("ist")}.`,
  pluralRule: `For more than one: ${german("wir sind, ihr seid")} for you all, and ${german("sie sind")} for they. Speaking formally, you say ${german("Sie sind")}.`,
  mnemonic: `${german("bin, bist, ist")}. A different word for each person, not an ending added on.`,
  closing: "That's it for today. The next time you say how you are, or how someone else is, use these out loud.",
  hook: { text: "Ich bin müde.", translation: "I am tired." },
  singularExamples: [
    { text: "Du bist müde.", translation: "You are tired, to a friend." },
    { text: "Sie ist müde.", translation: "She is tired." },
    { text: "Er ist müde.", translation: "He is tired." },
  ],
  pluralExamples: [
    { text: "Wir sind müde.", translation: "We are tired." },
    { text: "Ihr seid müde.", translation: "You all are tired." },
    { text: "Sie sind müde.", translation: "They are tired." },
    { text: "Sie sind zu Hause.", translation: "You are at home, formally." },
  ],
  practice: [
    gap("singular", "Ich ___ müde", "Ich bin müde.", "I am tired."),
    transform("singular", "sie", "er", "Sie ist müde.", "Er ist müde.", "He is tired."),
    gap("plural", "Wir ___ müde", "Wir sind müde.", "We are tired."),
    transform("plural", "Sie", "ihr", "Sie sind zu Hause.", "Ihr seid zu Hause.", "You all are at home."),
  ],
  checks: [
    { cue: `Which form of ${german("sein")} goes with ${german("ich")}?`, answer: german("bin.") },
    { cue: `Which form of ${german("sein")} goes with ${german("ihr")}, you all?`, answer: german("seid.") },
    { cue: `Speaking formally, which form goes with ${german("Sie")}?`, answer: german("Sie sind.") },
  ],
};

const HABEN: Paradigm = {
  title: "Haben, to have",
  welcome: `Today we'll learn how to use ${german("haben")}, to have.`,
  insight: `Most forms keep ${german("hab-")}, but ${german("du")} and ${german("er")} change: ${german("du hast, er hat")}. Not ${german("habst")}, and not ${german("habt")} for ${german("er")}.`,
  forms: { singular: "ich habe, du hast, er hat, sie hat, es hat", plural: "wir haben, ihr habt, sie haben, Sie haben" },
  singularRule: `For one person: ${german("ich habe, du hast")} when you talk to a friend, and ${german("er hat, sie hat, es hat")}.`,
  pluralRule: `For more than one: ${german("wir haben, ihr habt")} for you all, and ${german("sie haben")} for they. Speaking formally, you say ${german("Sie haben")}.`,
  mnemonic: `${german("habe, hast, hat")} for one. ${german("haben, habt, haben")} for more than one.`,
  closing: "That's it for today. The next time you say what you have, or what someone else has, use these out loud.",
  hook: { text: "Ich habe Zeit.", translation: "I have time." },
  singularExamples: [
    { text: "Ich habe Zeit.", translation: "I have time." },
    { text: "Du hast Zeit.", translation: "You have time, to a friend." },
    { text: "Sie hat Zeit.", translation: "She has time." },
  ],
  pluralExamples: [
    { text: "Wir haben Zeit.", translation: "We have time." },
    { text: "Ihr habt Hunger.", translation: "You all are hungry." },
    { text: "Sie haben ein Buch.", translation: "They have a book." },
    { text: "Sie haben Zeit.", translation: "You have time, formally." },
  ],
  practice: [
    gap("singular", "Ich ___ Zeit", "Ich habe Zeit.", "I have time."),
    transform("singular", "sie", "er", "Sie hat Zeit.", "Er hat Zeit.", "He has time."),
    gap("plural", "Wir ___ Zeit", "Wir haben Zeit.", "We have time."),
    transform("plural", "wir", "ihr", "Wir haben Zeit.", "Ihr habt Zeit.", "You all have time."),
  ],
  checks: [
    { cue: `Which form of ${german("haben")} goes with ${german("du")}, a friend?`, answer: german("hast.") },
    { cue: `Which form of ${german("haben")} goes with ${german("ihr")}, you all?`, answer: german("habt.") },
    { cue: `Speaking formally, which form goes with ${german("Sie")}?`, answer: german("Sie haben.") },
  ],
};

const REGULAR: Paradigm = {
  title: "A regular present tense",
  welcome: `Today we'll learn how to use a regular verb in the present, like ${german("machen")}, to make or to do.`,
  insight: `The stem ${german("mach-")} stays. You add an ending: ${german("ich mache, du machst, er macht")}. The ending changes, the stem does not.`,
  forms: { singular: "ich mache, du machst, er macht, sie macht, es macht", plural: "wir machen, ihr macht, sie machen, Sie machen" },
  singularRule: `For one person the stem stays ${german("mach-")}: ${german("ich mache, du machst")} for a friend, and ${german("er macht, sie macht, es macht")}.`,
  pluralRule: `For more than one: ${german("wir machen, ihr macht")} for you all, and ${german("sie machen")} for they. Speaking formally, you say ${german("Sie machen")}.`,
  mnemonic: `Keep the stem ${german("mach-")}. For one person, add ${german("-e, -st, -t")}.`,
  closing: "That's it for today. The next time you use a regular verb, start with the stem and add the ending out loud.",
  hook: { text: "Ich mache Kaffee.", translation: "I make coffee." },
  singularExamples: [
    { text: "Ich mache Kaffee.", translation: "I make coffee." },
    { text: "Du machst Sport.", translation: "You do sport, to a friend." },
    { text: "Sie macht Kaffee.", translation: "She makes coffee." },
  ],
  pluralExamples: [
    { text: "Wir machen Sport.", translation: "We do sport." },
    { text: "Ihr macht das.", translation: "You all do that." },
    { text: "Sie machen Kaffee.", translation: "They make coffee." },
    { text: "Sie machen das.", translation: "You do that, formally." },
  ],
  practice: [
    gap("singular", "Ich ___ Kaffee", "Ich mache Kaffee.", "I make coffee."),
    transform("singular", "ich", "du", "Ich mache Kaffee.", "Du machst Kaffee.", "You make coffee, to a friend."),
    gap("plural", "Wir ___ Sport", "Wir machen Sport.", "We do sport."),
    transform("plural", "wir", "ihr", "Wir machen Sport.", "Ihr macht Sport.", "You all do sport."),
  ],
  checks: [
    { cue: `Which ending goes with ${german("du")}, a friend?`, answer: german("st. du machst.") },
    { cue: `Which ending goes with ${german("ihr")}, you all?`, answer: german("t. ihr macht.") },
    { cue: `Speaking formally, which form of ${german("machen")} do you use?`, answer: german("Sie machen.") },
  ],
};

const PARADIGMS: Record<string, Paradigm> = {
  "de-sein": SEIN,
  "de-haben": HABEN,
  "de-present": REGULAR,
};

function spokenLesson(segments: LessonSegment[]): LessonSegment[] {
  const spoken: LessonSegment[] = [];
  for (const segment of segments) {
    const previous = spoken.at(-1);
    if (previous?.language === segment.language && !previous.pauseAfterMs && !segment.pauseAfterMs
        && spokenKey(previous.text) === spokenKey(segment.text)) continue;
    spoken.push({ ...segment, text: repairMarkup(segment.text.normalize("NFC")).trim() || segment.text });
  }
  return spoken;
}

function repeatsAnswer(previous: LessonSegment | undefined, answer: { text: string; language: LanguageId }): boolean {
  return previous?.kind === "drill" && !previous.pauseAfterMs && previous.language === answer.language
    && spokenKey(previous.text) === spokenKey(answer.text);
}

function takeCue(candidates: string[], used: Map<string, number>, start: number): string | null {
  if (candidates.length === 0) return null;
  for (let hop = 0; hop < candidates.length; hop += 1) {
    const cue = candidates[(start + hop) % candidates.length]!;
    if ((used.get(cue) ?? 0) >= MAX_IDENTICAL_CUES) continue;
    used.set(cue, (used.get(cue) ?? 0) + 1);
    return cue;
  }
  return null;
}

function produceCues(translation: string, teaching: LanguageId): string[] {
  return SPEAK_KEYS.map((key) => template(teaching, key).replaceAll("{translation}", translation));
}

function practiceCue(item: Practice, teaching: LanguageId): string {
  if (item.mode === "gap") {
    return line(teaching, "fill", { gap: german(item.gap), meaning: meaningOf(item.translation) });
  }
  return line(teaching, "change", { from: german(item.from), to: german(item.to), source: german(item.source) });
}

export function arrangeGrammarLesson(input: {
  source: GrammarSource;
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
  level: CefrLevel;
}): LessonSegment[] {
  const { source, nativeLanguage, targetLanguage, level } = input;
  const pacing = grammarPacing[level];
  const { thinkMs, listenMs } = conversationPacing[level];
  const segments: LessonSegment[] = [];
  const used = new Map<string, number>();
  const push = (segment: Omit<LessonSegment, "id" | "speaker" | "delivery"> & { delivery?: LessonSegment["delivery"] }, pauseMs = 0): void => {
    segments.push({
      id: `seg_${String(segments.length + 1).padStart(2, "0")}`,
      speaker: "teacher",
      delivery: segment.delivery ?? "warm",
      ...segment,
      ...(pauseMs > 0 ? { pauseAfterMs: pauseMs } : {}),
    });
  };
  const explain = (text: string, phase: string, kind: "explanation" | "narration" | "recap" = "explanation", pauseMs = 0): void => {
    push({ kind, phase, language: nativeLanguage, text, delivery: "clear" }, pauseMs);
  };
  const show = (example: Example, phase: string): void => {
    push({ kind: "example", phase, language: targetLanguage, text: example.text, translation: example.translation, delivery: "clear" });
    explain(exampleMeaning(example, nativeLanguage), phase, "explanation", listenMs);
  };
  const ask = (phase: string, item: Drill, index: number): void => {
    const translation = disambiguateTranslation(item.translation, item.answer, targetLanguage, nativeLanguage);
    const frames = produceCues(translation, nativeLanguage);
    const authored = lessonDisplayText(item.cue).toLocaleLowerCase();
    const carriesMeaning = authored.includes(lessonDisplayText(translation).toLocaleLowerCase());
    const guided = authored.includes("___") || Boolean(item.source && authored.includes(lessonDisplayText(item.source).toLocaleLowerCase()));
    const useAuthored = phase !== "review" && item.cue && (carriesMeaning || guided)
      && !authored.includes(spokenKey(item.answer));
    const prompt = carriesMeaning ? item.cue : `${item.cue} ${line(nativeLanguage, "turn", { translation })}`;
    const cue = takeCue(useAuthored ? [prompt, ...frames] : frames, used, useAuthored ? 0 : index);
    if (!cue || repeatsAnswer(segments.at(-1), { text: item.answer, language: targetLanguage })) return;
    push({ kind: "drill", phase, language: nativeLanguage, text: cue, delivery: "curious" }, speakingPauseMs(item.answer, targetLanguage) + thinkMs);
    push({ kind: "drill", phase: phase === "practice" ? "answer" : phase, language: targetLanguage, text: item.answer, translation, delivery: "clear" });
  };

  explain(source.welcome ?? line(nativeLanguage, "today", { topic: source.topic.title }), "intro", "narration");
  const models = uniqueExamples([source.hook, ...source.examples], pacing.examples);
  for (const [index, model] of models.entries()) show(model, index === 0 ? "hook" : "example");
  push({ kind: "drill", phase: "notice", language: nativeLanguage, text: source.noticeCue || line(nativeLanguage, "noticeWhat"), delivery: "curious" }, pacing.noticeMs);
  if (spokenKey(source.notice) !== spokenKey(source.rule)) explain(source.notice, "notice", "explanation", listenMs);
  explain(source.rule, "rule", "explanation", listenMs);

  const practice = models.map((model) => source.drills.find((drill) => spokenKey(drill.answer) === spokenKey(model.text))
    ?? { answer: model.text, translation: model.translation, cue: "" });
  const taught = new Set(practice.map((item) => spokenKey(item.answer)));
  const transfer = source.recombinations.find((item) => !taught.has(spokenKey(item.answer)));
  for (const item of source.drills) {
    if (practice.length >= pacing.drills) break;
    const key = spokenKey(item.answer);
    if (!taught.has(key) && (!transfer || key !== spokenKey(transfer.answer))) {
      taught.add(key);
      practice.push(item);
    }
  }

  for (const [index, item] of practice.entries()) {
    if (!models.some((example) => spokenKey(example.text) === spokenKey(item.answer))) {
      show({ text: item.answer, translation: item.translation }, "worked");
    }
    ask("practice", item, index);
    // Recall an earlier answer after practicing a different example.
    const earlier = practice[index - 1];
    if (earlier) ask("review", earlier, index + 1);
  }

  const reminder = source.usageTip || source.mnemonic;
  if (reminder && ![source.notice, source.rule].some((text) => spokenKey(text) === spokenKey(reminder))) explain(reminder, "usage", "explanation", listenMs);
  const check = source.checks[0];
  if (check) {
    push({ kind: "drill", phase: "check", language: nativeLanguage, text: check.cue, delivery: "curious" }, pacing.noticeMs);
    explain(check.answer, "check", "explanation", listenMs);
  }
  if (transfer) ask("recombine", transfer, 0);
  const anchor = practice[0];
  if (anchor) ask("review", anchor, practice.length + 2);
  explain(source.closing || line(nativeLanguage, "stick"), "closing", "recap");
  return spokenLesson(segments);
}

function localizeParadigm(paradigm: Paradigm, native: LanguageId): Paradigm {
  const g = german;
  const mean = (text: string) => grammarMeaning(native, text);
  const mapExample = (example: Example): Example => ({ ...example, translation: mean(example.translation) });
  const withSpeech = (key: "sein" | "haben" | "regular", vars: Record<string, string>): Paradigm => {
    const say = (suffix: string) => line(native, `${key}${suffix}` as TeachingKey, vars);
    return {
      ...paradigm,
      welcome: say("Welcome"),
      singularRule: say("Singular"),
      pluralRule: say("PluralRule"),
      mnemonic: say("Mnemonic"),
      closing: say("Closing"),
      hook: mapExample(paradigm.hook),
      singularExamples: paradigm.singularExamples.map(mapExample),
      pluralExamples: paradigm.pluralExamples.map(mapExample),
      practice: paradigm.practice.map((item) => ({ ...item, translation: mean(item.translation) })),
      checks: paradigm.checks.map((check, index) => ({ ...check, cue: say(`Check${index}`) })),
    };
  };
  if (paradigm.title.startsWith("Sein")) {
    return withSpeech("sein", {
      sein: g("sein"), Sein: g("Sein"), bin: g("bin"), ich: g("ich"), bist: g("bist"), du: g("du"),
      ist: g("ist"), erSie: g("er, sie"), es: g("es"), ichBin: g("ich bin, du bist"), sieIst: g("sie ist"),
      erIst: g("er ist"), esIst: g("es ist"), SieIst: g("Sie ist"), sieSind: g("sie sind"), Sie: g("Sie"),
      SieSind: g("Sie sind"), wirSind: g("wir sind, ihr seid"), binBistIst: g("bin, bist, ist"),
      singular: g("ich bin, du bist, er ist, sie ist, es ist"), plural: g("wir sind, ihr seid, sie sind"),
      chant: g("bin, bist, ist, sind, seid"), ihr: g("ihr"),
    });
  }
  if (paradigm.title.startsWith("Haben")) {
    return withSpeech("haben", {
      haben: g("haben"), hab: g("hab-"), du: g("du"), er: g("er"), duHast: g("du hast, er hat"),
      habst: g("habst"), habt: g("habt"), ichHabe: g("ich habe, du hast"), erHat: g("er hat, sie hat, es hat"),
      SieHat: g("Sie hat"), sieHaben: g("sie haben"), sieHat: g("sie hat"), SieHaben: g("Sie haben"),
      ihrHabt: g("ihr habt"), wirHaben: g("wir haben, ihr habt"), habeHastHat: g("habe, hast, hat"),
      habenHabt: g("haben, habt, haben"), singular: g("ich habe, du hast, er hat, sie hat, es hat"),
      plural: g("wir haben, ihr habt, sie haben"), chant: g("habe, hast, hat, haben, habt"),
      ihr: g("ihr"), Sie: g("Sie"),
    });
  }
  return withSpeech("regular", {
    machen: g("machen"), mach: g("mach-"), forms: g("ich mache, du machst, er macht"),
    ichMache: g("ich mache, du machst"), erMacht: g("er macht, sie macht, es macht"),
    ErMacht: g("Er macht"), ihrMacht: g("ihr macht"), wir: g("wir"), sie: g("sie"),
    wirMachen: g("wir machen"), sieMachen: g("sie machen"), en: g("-en"), t: g("-t"), st: g("-st"),
    sieMacht: g("sie macht"), SieMachen: g("Sie machen"), endings: g("-e, -st, -t"),
    wirIhr: g("wir machen, ihr macht"),
    parade: g("machen: ich mache, du machst, er macht, sie macht, es macht, wir machen, ihr macht, sie machen"),
    chant: g("e, st, t, en, t, en"),
    du: g("du"), ihr: g("ihr"),
  });
}

function paradigmSource(source: Paradigm, topic: GrammarTopic, nativeLanguage: LanguageId, teacherName: string): GrammarSource {
  const paradigm = localizeParadigm(source, nativeLanguage);
  const plural = topic.id.endsWith("-plural");
  const examples = plural
    // Include the formal use as a real example, alongside the group forms.
    ? [...paradigm.pluralExamples.slice(0, 2), paradigm.pluralExamples.at(-1)!]
    : uniqueExamples([paradigm.hook, ...paradigm.singularExamples], grammarPacing.A1.examples);
  const rule = plural ? paradigm.pluralRule : paradigm.singularRule;
  const drills = paradigm.practice
    .filter((item) => item.half === (plural ? "plural" : "singular"))
    .map((item): Drill => ({
      answer: item.answer,
      translation: item.translation,
      cue: practiceCue(item, nativeLanguage),
      ...(item.mode === "transform" ? { source: item.source } : {}),
    }));

  const check = paradigm.checks[plural ? 2 : 0];
  return {
    title: plural ? topic.title : paradigm.title,
    topic,
    summary: topic.focus,
    teacherName,
    hook: examples[0]!,
    examples: examples.slice(1),
    notice: rule,
    noticeCue: line(nativeLanguage, "noticeVerb"),
    rule,
    mnemonic: !plural && source === REGULAR ? paradigm.mnemonic : "",
    welcome: paradigm.welcome,
    closing: paradigm.closing,
    drills: drills.filter((item) => examples.some((example) => spokenKey(example.text) === spokenKey(item.answer))),
    recombinations: drills.filter((item) => !examples.some((example) => spokenKey(example.text) === spokenKey(item.answer))),
    checks: check ? [check] : [],
  };
}

export function grammarPromptsAreClear(segments: LessonSegment[]): boolean {
  for (let index = 0; index < segments.length; index += 1) {
    const prompt = segments[index];
    if (!prompt?.pauseAfterMs || prompt.kind !== "drill") continue;
    const answer = segments[index + 1];
    if (!answer || prompt.speaker !== "teacher" || answer.speaker !== "teacher") return false;
    if (prompt.phase === "notice") continue;
    if (prompt.phase === "check") {
      if (!prompt.text.trim() || !answer.text.trim()) return false;
      continue;
    }
    const meaning = meaningOf(answer.translation ?? "");
    const cites = meaning.length >= 2 && prompt.text.toLocaleLowerCase().includes(meaning.toLocaleLowerCase());
    const transforms = /make|change|put|turn|negative|question|plural|past|formal|without|now/i.test(prompt.text)
      && prompt.text.includes(":")
      && prompt.text.trim() !== answer.text.trim();
    if (!cites && !transforms) return false;
  }
  return true;
}

export function shapeGrammarLesson(value: unknown, context: {
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
  level: CefrLevel;
  topic: GrammarTopic;
  /** Ignored. Phrases from earlier lessons are recalled only in conversation lessons. */
  priorReviews?: Example[];
}): { title: string; topic: string; ruleId: string; summary: string; speakerNames: SpeakerNames; segments: LessonSegment[] } | null {
  const paradigm = PARADIGMS[context.topic.id.replace(/-plural$/u, "")];
  const model = value && typeof value === "object" ? value as { speakerNames?: unknown } : {};
  const source = paradigm
    ? paradigmSource(paradigm, context.topic, context.nativeLanguage, normalizeSpeakerNames(model.speakerNames).teacher)
    : parseGrammarSource(value, context.topic, context.level, context.targetLanguage);
  if (!source) return null;
  const arranged = arrangeGrammarLesson({ ...context, source });
  if (paradigm) return {
    title: source.title,
    topic: source.topic.title,
    ruleId: source.topic.id,
    summary: source.summary,
    speakerNames: normalizeSpeakerNames({ teacher: source.teacherName }),
    segments: arranged,
  };
  const affixes = arranged
    .filter((segment) => segment.language === context.nativeLanguage)
    .flatMap((segment) => lessonDisplayText(segment.text).match(
      /(?<![\p{L}\p{M}\p{N}\p{Pd}])(?:[-‐][\p{L}\p{M}]+|[\p{L}\p{M}]+[-‐])(?![\p{L}\p{M}\p{N}\p{Pd}])/gu,
    ) ?? []);
  const { segments, leftover } = applyTargetVoices(arranged, context.nativeLanguage, context.targetLanguage, [
    ...(source.targetTerms ?? []), ...affixes,
    ...[...source.drills, ...source.recombinations].flatMap((drill) => drill.source ? [drill.source] : []),
  ]);
  if (leftover.length > 0 || segments.some((segment) => speechSpans(segment.text, segment.language).some((span) => (
    span.language !== context.nativeLanguage && span.language !== context.targetLanguage
  )))) return null;
  return {
    title: source.title,
    topic: context.topic.title.slice(0, 160),
    ruleId: context.topic.id,
    summary: source.summary,
    speakerNames: normalizeSpeakerNames({ teacher: source.teacherName }),
    segments,
  };
}
