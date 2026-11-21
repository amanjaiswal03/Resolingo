import type { LanguageId } from "./languages.js";
import type { CefrLevel } from "./schemas.js";
import { applyTargetVoices, lessonDisplayText, repairMarkup, speechSpans } from "./markup.js";
import {
  MAX_PIMSLEUR_SEGMENTS,
  scheduleReviewSlots,
} from "./pimsleur.js";
import { speakingPauseMs } from "./speaking-timing.js";
import type { LessonSegment } from "./schemas.js";
import { normalizeSpeakerNames, type SpeakerNames } from "./speakers.js";

/** A short pause while the learner notices a pattern, before the teacher names it. */
export const NOTICE_PAUSE_MS = 3_000;

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1"];

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
    { id: "de-sein", title: "Present tense of sein", focus: "ich bin, du bist, er ist, and the plural forms, in real sentences" },
    { id: "de-haben", title: "Present tense of haben", focus: "ich habe, du hast, and when haben means possession" },
    { id: "de-gender", title: "Noun gender and der, die, das", focus: "the article as part of the noun, with a few reliable ending cues" },
    { id: "de-present", title: "Regular verbs in the present tense", focus: "the stem plus the personal endings, used in short sentences" },
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
    { id: "g-be-have", title: "Be and have", focus: "the present forms of be and have in short sentences" },
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
    const notes = TOPIC_NOTES[row.id];
    return {
      ...row,
      level,
      prerequisites: rows.slice(0, index).map((earlier) => earlier.title),
      ...(notes ? { insight: lessonDisplayText(notes.insight), forms: notes.forms, pitfall: notes.pitfall } : {}),
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

export function grammarLevelAllowsException(level: CefrLevel): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf("A2");
}

type Example = { text: string; translation: string };
type DrillKind = "word" | "phrase" | "sentence";
type Drill = { cue: string; answer: string; translation: string; source?: string; kind?: DrillKind };
type Address = "friend" | "all" | "formal" | "she" | "they";

/**
 * The PR #17 speak-prompt pool, each one still naming the meaning.
 * A cue with no meaning ("Say it out loud.") is not usable on its own.
 */
const SPEAK_FRAMES = [
  "How would you say {translation}?",
  "Can you say {translation}?",
  "Try saying {translation}.",
  "Give it a try: {translation}.",
  "Your turn: {translation}.",
  "Say it out loud: {translation}.",
  "Now you say it: {translation}.",
  "What would you say for {translation}?",
] as const;

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
  rule: string;
  mnemonic: string;
  targetTerms?: string[];
  exception?: string;
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

/** Name which "you" (or she/they) the target form is, when the native cue would otherwise be ambiguous. */
export function disambiguateTranslation(translation: string, answer: string, language: string): string {
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
export function drillCue(drill: Drill): string {
  const meaning = meaningOf(drill.translation);
  const cue = drill.cue.trim();
  const citesMeaning = meaning.length >= 2 && cue.toLocaleLowerCase().includes(meaning.toLocaleLowerCase());
  const source = drill.source ?? "";
  const transforms = source.length > 0
    && cue.includes(source)
    && source.trim() !== drill.answer.trim()
    && /make|change|put|turn|negative|question|plural|past|formal|without|now/i.test(cue);
  if (citesMeaning || transforms) return cue.slice(0, 280);
  return `How would you say ${meaning}?`;
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

export function parseGrammarSource(value: unknown, topic: GrammarTopic, level: CefrLevel): GrammarSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const examples = uniqueExamples(
    (Array.isArray(record.examples) ? record.examples : []).map(exampleFrom).filter((item): item is Example => Boolean(item)),
    3,
  );
  const hook = exampleFrom(record.hook) ?? examples[0] ?? null;
  if (!hook || examples.length < 2) return null;
  const drills = (Array.isArray(record.drills) ? record.drills : [])
    .map(drillFrom)
    .filter((item): item is Drill => Boolean(item))
    .sort((left, right) => DRILL_ORDER[left.kind ?? "phrase"] - DRILL_ORDER[right.kind ?? "phrase"])
    .slice(0, 6);
  if (drills.length < 4) return null;
  const recombinations = (Array.isArray(record.recombinations) ? record.recombinations : [])
    .map(drillFrom)
    .filter((item): item is Drill => Boolean(item))
    .slice(0, 2);
  const checks = (Array.isArray(record.checks) ? record.checks : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const cue = textOf(row.cue ?? row.prompt);
      const answer = textOf(row.answer);
      return cue && answer ? { cue: cue.slice(0, 420), answer: answer.slice(0, 420) } : null;
    })
    .filter((item): item is RuleCheck => Boolean(item))
    .slice(0, 2);
  const rule = textOf(record.rule) || textOf(record.summary);
  const mnemonic = textOf(record.mnemonic) || rule.split(/[.。]/u)[0]?.trim() || rule;
  if (!rule || !mnemonic) return null;
  const exception = textOf(record.exception);
  const targetTerms = Array.isArray(record.targetTerms)
    ? record.targetTerms.map(textOf).filter((term) => term.length > 0 && term.length <= 80).slice(0, 80)
    : [];
  const names = normalizeSpeakerNames(record.speakerNames);
  const title = textOf(record.title) || topic.title;
  return {
    title: title.slice(0, 90),
    topic,
    summary: (textOf(record.summary) || topic.focus).slice(0, 280),
    teacherName: names.teacher,
    hook,
    examples,
    notice: (textOf(record.notice) || rule).slice(0, 640),
    rule: rule.slice(0, 640),
    mnemonic: mnemonic.slice(0, 420),
    ...(targetTerms.length > 0 ? { targetTerms } : {}),
    ...(exception && grammarLevelAllowsException(level) ? { exception: exception.slice(0, 420) } : {}),
    drills,
    checks: checks.length > 0 ? checks : [{ cue: "What is the pattern?", answer: mnemonic.slice(0, 420) }],
    recombinations,
  };
}

function exampleMeaning(example: Example): string {
  return `That means "${meaningOf(example.translation)}".`;
}

function inLanguage(language: LanguageId, text: string): string {
  return `[[lang:${language}]]${text}[[/lang]]`;
}

function german(text: string): string {
  return inLanguage("de-DE", text);
}

type PracticeMode = "produce" | "transform" | "gap";
type Practice = {
  answer: string;
  translation: string;
  half: "singular" | "plural";
  mode: PracticeMode;
  source?: string;
  gap?: string;
  from?: string;
  to?: string;
};

type Paradigm = {
  title: string;
  summary: string;
  welcome: string;
  insight: string;
  forms: string;
  pitfall: string;
  reject: RegExp;
  offTopic: RegExp;
  singularRule: string;
  pluralBridge: string;
  pluralQuestion: string;
  pluralInsight: string;
  pluralRule: string;
  mnemonic: string;
  recap: [string, string];
  closing: string;
  hook: Example;
  singularExamples: Example[];
  pluralExamples: Example[];
  practice: Practice[];
  checks: Array<{ cue: string; answer: string }>;
};

function produce(half: Practice["half"], answer: string, translation: string): Practice {
  return { half, mode: "produce", answer, translation };
}
function transform(half: Practice["half"], from: string, to: string, source: string, answer: string, translation: string): Practice {
  return { half, mode: "transform", from, to, source, answer, translation };
}
function gap(half: Practice["half"], missing: string, answer: string, translation: string): Practice {
  return { half, mode: "gap", gap: missing, answer, translation };
}

const OFF_TOPIC = /second position|second idea|word order|where does the verb|nicht|kein|accusative|der, die, das|perfekt|modal verb/i;

const SEIN: Paradigm = {
  title: "Sein, to be",
  summary: "The present tense of sein for one person, then for more than one, including the formal you.",
  welcome: `Today we'll learn how to use ${german("sein")}, to be.`,
  insight: `${german("Sein")} does not add a regular ending. The word itself changes: ${german("bin")} for ${german("ich")}, ${german("bist")} for ${german("du")}, and ${german("ist")} for ${german("er, sie")} and ${german("es")}.`,
  forms: "ich bin, du bist, er ist, sie ist, es ist, wir sind, ihr seid, sie sind, Sie sind",
  pitfall: "sie ist is she. sie sind is they. Sie sind, written with a capital, is you, formally. Learners also invent a regular ending instead of bin, bist, and ist.",
  reject: /ending changes|regular ending|second position|second idea|word order/i,
  offTopic: OFF_TOPIC,
  singularRule: `For one person: ${german("ich bin, du bist")} when you talk to a friend, and ${german("sie ist")}. ${german("er ist")} and ${german("es ist")} use that same ${german("ist")}.`,
  pluralBridge: "That is one person. Now more than one person, and the formal you.",
  pluralQuestion: `${german("Sie ist")} and ${german("sie sind")} look similar. What changes?`,
  pluralInsight: `${german("sie ist")} is she, one person. ${german("sie sind")} is they. When ${german("Sie")} is written as the formal you, you still say ${german("Sie sind")}.`,
  pluralRule: `For more than one: ${german("wir sind, ihr seid")} for you all, and ${german("sie sind")} for they. Speaking formally, you say ${german("Sie sind")}.`,
  mnemonic: `${german("bin, bist, ist")}. A different word for each person, not an ending added on.`,
  recap: [
    `Here is ${german("sein")}, to be. One person: ${german("ich bin, du bist, er ist, sie ist, es ist")}. More than one: ${german("wir sind, ihr seid, sie sind")}, and ${german("Sie sind")} when you are formal.`,
    `Hold onto the chant: ${german("bin, bist, ist, sind, seid")}.`,
  ],
  closing: "Nice work. The next time you say how you are, or how someone else is, use these out loud. That's how they stay with you.",
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
    produce("singular", "Ich bin", "I am"),
    produce("singular", "Du bist", "you are, to a friend"),
    produce("singular", "Er ist", "he is"),
    produce("singular", "Sie ist", "she is"),
    produce("singular", "Es ist", "it is"),
    produce("singular", "Ich bin müde.", "I am tired"),
    produce("singular", "Du bist hier.", "you are here, to a friend"),
    produce("singular", "Er ist Student.", "he is a student"),
    produce("singular", "Sie ist Studentin.", "she is a student"),
    produce("singular", "Es ist bereit.", "it is ready"),
    produce("singular", "Ich bin zu Hause.", "I am at home"),
    produce("singular", "Du bist bereit.", "you are ready, to a friend"),
    transform("singular", "ich", "sie", "Ich bin müde.", "Sie ist müde.", "she is tired"),
    gap("singular", "Ich ___ hier", "Ich bin hier.", "I am here"),
    produce("plural", "Wir sind", "we are"),
    produce("plural", "Ihr seid", "you all are"),
    produce("plural", "Sie sind", "they are"),
    produce("plural", "Wir sind bereit.", "we are ready"),
    produce("plural", "Ihr seid zu Hause.", "you all are at home"),
    produce("plural", "Sie sind hier.", "they are here"),
    produce("plural", "Sie sind zu Hause.", "you are at home, formally"),
    produce("plural", "Wir sind hier.", "we are here"),
    produce("plural", "Ihr seid bereit.", "you all are ready"),
    transform("plural", "du", "ihr", "Du bist müde.", "Ihr seid müde.", "you all are tired"),
    gap("plural", "Wir ___ müde", "Wir sind müde.", "we are tired"),
  ],
  checks: [
    { cue: `Which form of ${german("sein")} goes with ${german("ich")}?`, answer: german("bin.") },
    { cue: `Which form of ${german("sein")} goes with ${german("ihr")}, you all?`, answer: german("seid.") },
    { cue: `Speaking formally, which form goes with ${german("Sie")}?`, answer: german("Sie sind.") },
  ],
};

const HABEN: Paradigm = {
  title: "Haben, to have",
  summary: "The present tense of haben, including the irregular du and er forms.",
  welcome: `Today we'll learn how to use ${german("haben")}, to have.`,
  insight: `Most forms keep ${german("hab-")}, but ${german("du")} and ${german("er")} change: ${german("du hast, er hat")}. Not ${german("habst")}, and not ${german("habt")} for ${german("er")}.`,
  forms: "ich habe, du hast, er hat, sie hat, es hat, wir haben, ihr habt, sie haben, Sie haben",
  pitfall: "du hast and er hat are irregular. sie hat is she has. sie haben is they have. Sie haben is you have, formally.",
  reject: /second position|second idea|word order|regular ending only|sein does not/i,
  offTopic: OFF_TOPIC,
  singularRule: `For one person: ${german("ich habe, du hast")} when you talk to a friend, and ${german("er hat, sie hat, es hat")}.`,
  pluralBridge: "That is one person. Now more than one, and the formal you.",
  pluralQuestion: `${german("Sie hat")} and ${german("sie haben")} are not the same person. What is the difference?`,
  pluralInsight: `${german("sie hat")} is she has. ${german("sie haben")} is they have. The formal you is ${german("Sie haben")}. ${german("ihr habt")} is you all.`,
  pluralRule: `For more than one: ${german("wir haben, ihr habt")} for you all, and ${german("sie haben")} for they. Speaking formally, you say ${german("Sie haben")}.`,
  mnemonic: `${german("habe, hast, hat")} for one. ${german("haben, habt, haben")} for more than one.`,
  recap: [
    `Here is ${german("haben")}, to have. One person: ${german("ich habe, du hast, er hat, sie hat, es hat")}. More than one: ${german("wir haben, ihr habt, sie haben")}, and ${german("Sie haben")} when you are formal.`,
    `Hold onto the chant: ${german("habe, hast, hat, haben, habt")}.`,
  ],
  closing: "Nice work. The next time you say what you have, or what someone else has, use these out loud. That's how they stay with you.",
  hook: { text: "Ich habe Zeit.", translation: "I have time." },
  singularExamples: [
    { text: "Ich habe Zeit.", translation: "I have time." },
    { text: "Du hast Hunger.", translation: "You are hungry, to a friend." },
    { text: "Sie hat ein Buch.", translation: "She has a book." },
  ],
  pluralExamples: [
    { text: "Wir haben Zeit.", translation: "We have time." },
    { text: "Ihr habt Hunger.", translation: "You all are hungry." },
    { text: "Sie haben ein Buch.", translation: "They have a book." },
    { text: "Sie haben Zeit.", translation: "You have time, formally." },
  ],
  practice: [
    produce("singular", "Ich habe", "I have"),
    produce("singular", "Du hast", "you have, to a friend"),
    produce("singular", "Er hat", "he has"),
    produce("singular", "Sie hat", "she has"),
    produce("singular", "Es hat", "it has"),
    produce("singular", "Ich habe Zeit.", "I have time"),
    produce("singular", "Du hast Hunger.", "you are hungry, to a friend"),
    produce("singular", "Er hat ein Buch.", "he has a book"),
    produce("singular", "Sie hat Zeit.", "she has time"),
    transform("singular", "ich", "du", "Ich habe Zeit.", "Du hast Zeit.", "you have time, to a friend"),
    gap("singular", "Er ___ Zeit", "Er hat Zeit.", "he has time"),
    produce("plural", "Wir haben", "we have"),
    produce("plural", "Ihr habt", "you all have"),
    produce("plural", "Sie haben", "they have"),
    produce("plural", "Wir haben Hunger.", "we are hungry"),
    produce("plural", "Ihr habt Zeit.", "you all have time"),
    produce("plural", "Sie haben Hunger.", "they are hungry"),
    produce("plural", "Sie haben ein Buch.", "you have a book, formally"),
    transform("plural", "du", "ihr", "Du hast Zeit.", "Ihr habt Zeit.", "you all have time"),
    gap("plural", "Wir ___ Zeit", "Wir haben Zeit.", "we have time"),
  ],
  checks: [
    { cue: `Which form of ${german("haben")} goes with ${german("du")}, a friend?`, answer: german("hast.") },
    { cue: `Which form of ${german("haben")} goes with ${german("ihr")}, you all?`, answer: german("habt.") },
    { cue: `Speaking formally, which form goes with ${german("Sie")}?`, answer: german("Sie haben.") },
  ],
};

const REGULAR: Paradigm = {
  title: "A regular present tense",
  summary: "The present-tense endings of a regular verb, using machen.",
  welcome: `Today we'll learn how to use a regular verb in the present, like ${german("machen")}, to make or to do.`,
  insight: `The stem ${german("mach-")} stays. You add an ending: ${german("ich mache, du machst, er macht")}. The ending changes, the stem does not.`,
  forms: "ich mache, du machst, er macht, sie macht, es macht, wir machen, ihr macht, sie machen, Sie machen",
  pitfall: "ihr macht takes -t, the same ending as er macht, not -st. sie macht is she. sie machen is they. Sie machen is you, formally.",
  reject: /second position|second idea|word order|the word itself changes completely/i,
  offTopic: OFF_TOPIC,
  singularRule: `For one person the stem stays ${german("mach-")}: ${german("ich mache, du machst")} for a friend, and ${german("er macht, sie macht, es macht")}.`,
  pluralBridge: "That is one person. The stem stays. Now the plural endings.",
  pluralQuestion: `${german("Er macht")} and ${german("ihr macht")} share an ending. What do ${german("wir")} and ${german("sie")} do?`,
  pluralInsight: `${german("wir machen")} and ${german("sie machen")} take ${german("-en")}. ${german("ihr macht")} takes ${german("-t")}, not ${german("-st")}. ${german("sie macht")} is she. ${german("sie machen")} is they. ${german("Sie machen")} is you, formally.`,
  pluralRule: `For more than one: ${german("wir machen, ihr macht")} for you all, and ${german("sie machen")} for they. Speaking formally, you say ${german("Sie machen")}.`,
  mnemonic: `Keep the stem ${german("mach-")}. For one person, add ${german("-e, -st, -t")}.`,
  recap: [
    `A regular verb keeps its stem. ${german("machen: ich mache, du machst, er macht, sie macht, es macht, wir machen, ihr macht, sie machen")}, and ${german("Sie machen")} when you are formal.`,
    `Hold onto the endings: ${german("e, st, t, en, t, en")}.`,
  ],
  closing: "Nice work. The next time you use a regular verb, start with the stem and add the ending out loud. That's how the pattern sticks.",
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
    produce("singular", "Ich mache", "I make"),
    produce("singular", "Du machst", "you make, to a friend"),
    produce("singular", "Er macht", "he makes"),
    produce("singular", "Sie macht", "she makes"),
    produce("singular", "Es macht", "it makes"),
    produce("singular", "Ich mache Kaffee.", "I make coffee"),
    produce("singular", "Du machst Sport.", "you do sport, to a friend"),
    produce("singular", "Er macht das.", "he does that"),
    produce("singular", "Sie macht Sport.", "she does sport"),
    transform("singular", "ich", "du", "Ich mache Kaffee.", "Du machst Kaffee.", "you make coffee, to a friend"),
    gap("singular", "Ich ___ Kaffee", "Ich mache Kaffee.", "I make coffee"),
    produce("plural", "Wir machen", "we make"),
    produce("plural", "Ihr macht", "you all make"),
    produce("plural", "Sie machen", "they make"),
    produce("plural", "Wir machen das.", "we do that"),
    produce("plural", "Ihr macht Sport.", "you all do sport"),
    produce("plural", "Sie machen Sport.", "they do sport"),
    produce("plural", "Sie machen Kaffee.", "you make coffee, formally"),
    transform("plural", "du", "ihr", "Du machst Sport.", "Ihr macht Sport.", "you all do sport"),
    gap("plural", "Wir ___ das", "Wir machen das.", "we do that"),
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

const TOPIC_NOTES: Record<string, { insight: string; forms: string; pitfall: string }> = {
  "de-sein": { insight: SEIN.insight, forms: SEIN.forms, pitfall: SEIN.pitfall },
  "de-haben": { insight: HABEN.insight, forms: HABEN.forms, pitfall: HABEN.pitfall },
  "de-present": { insight: REGULAR.insight, forms: REGULAR.forms, pitfall: REGULAR.pitfall },
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

function produceCues(translation: string): string[] {
  return SPEAK_FRAMES.map((frame) => frame.replaceAll("{translation}", translation));
}

function practiceCues(item: Practice, translation: string, language: LanguageId): string[] {
  if (item.mode === "transform" && item.source && item.from && item.to) {
    const from = inLanguage(language, item.from);
    const to = inLanguage(language, item.to);
    const source = inLanguage(language, item.source);
    return [
      `Change ${from} to ${to}: ${source}`,
      `Now make it ${to}: ${source}`,
      `Put this in the ${to} form: ${source}`,
    ];
  }
  if (item.mode === "gap" && item.gap) {
    const gap = inLanguage(language, item.gap);
    return [
      `Fill the gap. ${gap}. The meaning is ${translation}.`,
      `What is missing? ${gap}. The meaning is ${translation}.`,
      `Complete it. ${gap}. The meaning is ${translation}.`,
    ];
  }
  return produceCues(translation);
}

export function arrangeGrammarLesson(input: {
  source: GrammarSource;
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
}): LessonSegment[] {
  const segments: LessonSegment[] = [];
  const used = new Map<string, number>();
  let ordinal = 0;
  const push = (segment: Omit<LessonSegment, "id" | "speaker" | "delivery"> & { delivery?: LessonSegment["delivery"] }, pauseMs = 0): boolean => {
    if (segments.length >= MAX_PIMSLEUR_SEGMENTS) return false;
    ordinal += 1;
    segments.push({
      id: `seg_${String(ordinal).padStart(2, "0")}`,
      speaker: "teacher",
      delivery: segment.delivery ?? "warm",
      ...segment,
      ...(pauseMs > 0 ? { pauseAfterMs: pauseMs } : {}),
    });
    return true;
  };
  const ask = (phase: string, cue: string | null, answer: { text: string; translation?: string; language: LanguageId }, pause = speakingPauseMs(answer.text, answer.language)): void => {
    if (!cue || segments.length + 2 > MAX_PIMSLEUR_SEGMENTS - 4 || repeatsAnswer(segments.at(-1), answer)) return;
    push({ kind: "drill", phase, language: input.nativeLanguage, text: cue, delivery: "curious" }, pause);
    push({
      kind: "drill",
      phase: phase === "check" ? "check" : phase === "practice" ? "answer" : phase,
      language: answer.language,
      text: answer.text,
      ...(answer.translation ? { translation: answer.translation } : {}),
      delivery: "clear",
    });
  };
  const askMeaning = (phase: string, translation: string, answer: { text: string; translation?: string; language: LanguageId }, index: number): void => {
    const clear = disambiguateTranslation(translation, answer.text, input.targetLanguage);
    ask(phase, takeCue(produceCues(clear), used, index), { ...answer, translation: clear });
  };

  const label = `${input.source.topic.title.charAt(0).toLocaleLowerCase()}${input.source.topic.title.slice(1)}`;
  const welcome = `Today we'll learn ${label}.`;
  push({ kind: "narration", phase: "intro", language: input.nativeLanguage, text: welcome, delivery: "warm" });

  push({ kind: "narration", phase: "hook", language: input.nativeLanguage, text: "Listen to one real sentence. This is why the pattern matters.", delivery: "warm" });
  push({ kind: "example", phase: "hook", language: input.targetLanguage, text: input.source.hook.text, translation: input.source.hook.translation, delivery: "clear" });
  push({ kind: "explanation", phase: "hook", language: input.nativeLanguage, text: exampleMeaning(input.source.hook), delivery: "clear" });

  uniqueExamples([input.source.hook, ...input.source.examples], 4).slice(1).forEach((example) => {
    push({ kind: "example", phase: "example", language: input.targetLanguage, text: example.text, translation: example.translation, delivery: "clear" });
    push({ kind: "explanation", phase: "example", language: input.nativeLanguage, text: exampleMeaning(example), delivery: "clear" });
  });
  const notice = input.source.topic.insight && input.source.topic.insight.length > 0 ? input.source.topic.insight : input.source.notice;
  ask("notice", "What do you notice here?", { text: notice, language: input.nativeLanguage }, NOTICE_PAUSE_MS);

  const mnemonic = spokenKey(input.source.rule) !== spokenKey(input.source.mnemonic) ? input.source.mnemonic : undefined;
  push({ kind: "explanation", phase: "rule", language: input.nativeLanguage, text: input.source.rule, delivery: "clear" });
  if (mnemonic) push({ kind: "explanation", phase: "rule", language: input.nativeLanguage, text: `Hold onto this: ${mnemonic}`, delivery: "clear" });
  if (input.source.exception) {
    push({ kind: "explanation", phase: "rule", language: input.nativeLanguage, text: `One common exception: ${input.source.exception}`, delivery: "clear" });
  }

  const drills = input.source.drills;
  const slots = scheduleReviewSlots(drills.length, Math.min(10, drills.length));
  const after = new Map<number, number[]>();
  const ending: number[] = [];
  for (const slot of slots) {
    if (slot.afterItem >= drills.length) ending.push(slot.item);
    else after.set(slot.afterItem, [...(after.get(slot.afterItem) ?? []), slot.item]);
  }
  drills.forEach((drill, index) => {
    const translation = disambiguateTranslation(drill.translation, drill.answer, input.targetLanguage);
    const cue = drill.cue.includes(":") || drill.cue.includes("___")
      ? takeCue([drill.cue, ...produceCues(translation)], used, index)
      : takeCue(produceCues(translation), used, index);
    ask("practice", cue, { text: drill.answer, translation, language: input.targetLanguage });
    for (const earlier of after.get(index) ?? []) {
      const item = drills[earlier];
      if (!item) continue;
      const again = disambiguateTranslation(item.translation, item.answer, input.targetLanguage);
      ask("review", takeCue(produceCues(again), used, index + earlier + 1), { text: item.answer, translation: again, language: input.targetLanguage });
    }
    if (index === 2 && input.source.checks[0] && !OFF_TOPIC.test(input.source.checks[0].cue) && !OFF_TOPIC.test(input.source.checks[0].answer)) {
      ask("check", input.source.checks[0].cue, { text: input.source.checks[0].answer, language: input.nativeLanguage });
    }
  });
  for (const fresh of input.source.recombinations) {
    const translation = disambiguateTranslation(fresh.translation, fresh.answer, input.targetLanguage);
    ask("recombine", takeCue(produceCues(translation), used, 4), { text: fresh.answer, translation, language: input.targetLanguage });
  }
  push({ kind: "recap", phase: "summary", language: input.nativeLanguage, text: input.source.rule, delivery: "clear" });
  if (mnemonic) push({ kind: "recap", phase: "summary", language: input.nativeLanguage, text: `Hold onto this: ${mnemonic}`, delivery: "clear" });
  const quick = [...ending, 0, Math.min(1, drills.length - 1)].filter((index, position, all) => all.indexOf(index) === position).slice(0, 3);
  for (const index of quick) {
    const item = drills[index];
    if (!item) continue;
    const again = disambiguateTranslation(item.translation, item.answer, input.targetLanguage);
    ask("review", takeCue(produceCues(again), used, index + 5), { text: item.answer, translation: again, language: input.targetLanguage });
  }
  const closingCheck = input.source.checks.find((check) => !OFF_TOPIC.test(check.cue) && !OFF_TOPIC.test(check.answer));
  if (closingCheck) ask("check", closingCheck.cue, { text: closingCheck.answer, language: input.nativeLanguage });
  push({ kind: "recap", phase: "closing", language: input.nativeLanguage, text: "Nice work. Use this the next time you speak, even in one short sentence. That's how it sticks.", delivery: "praise" });

  return spokenLesson(segments);
}

function arrangeParadigm(paradigm: Paradigm, input: {
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
}): LessonSegment[] {
  const segments: LessonSegment[] = [];
  const used = new Map<string, number>();
  let ordinal = 0;
  const push = (segment: Omit<LessonSegment, "id" | "speaker" | "delivery"> & { delivery?: LessonSegment["delivery"] }, pauseMs = 0): boolean => {
    if (segments.length >= MAX_PIMSLEUR_SEGMENTS) return false;
    ordinal += 1;
    segments.push({
      id: `seg_${String(ordinal).padStart(2, "0")}`,
      speaker: "teacher",
      delivery: segment.delivery ?? "warm",
      ...segment,
      ...(pauseMs > 0 ? { pauseAfterMs: pauseMs } : {}),
    });
    return true;
  };
  const ask = (phase: string, cue: string | null, answer: { text: string; translation?: string; language: LanguageId }, pause = speakingPauseMs(answer.text, answer.language)): void => {
    if (!cue || segments.length + 2 > MAX_PIMSLEUR_SEGMENTS - 6 || repeatsAnswer(segments.at(-1), answer)) return;
    push({ kind: "drill", phase, language: input.nativeLanguage, text: cue, delivery: "curious" }, pause);
    push({
      kind: "drill",
      phase: phase === "check" ? "check" : phase === "practice" ? "answer" : phase,
      language: answer.language,
      text: answer.text,
      ...(answer.translation ? { translation: answer.translation } : {}),
      delivery: "clear",
    });
  };
  const show = (example: Example, phase: string): void => {
    push({ kind: "example", phase, language: input.targetLanguage, text: example.text, translation: example.translation, delivery: "clear" });
    push({ kind: "explanation", phase, language: input.nativeLanguage, text: exampleMeaning(example), delivery: "clear" });
  };

  push({ kind: "narration", phase: "intro", language: input.nativeLanguage, text: paradigm.welcome, delivery: "warm" });
  push({ kind: "narration", phase: "hook", language: input.nativeLanguage, text: "Listen to one real sentence. This is why the pattern matters.", delivery: "warm" });
  show(paradigm.hook, "hook");
  uniqueExamples([paradigm.hook, ...paradigm.singularExamples], 4).slice(1).forEach((example) => show(example, "example"));
  ask("notice", "What happens to the verb itself when the person changes?", { text: paradigm.insight, language: input.nativeLanguage }, NOTICE_PAUSE_MS);
  push({ kind: "explanation", phase: "rule", language: input.nativeLanguage, text: paradigm.singularRule, delivery: "clear" });
  push({ kind: "explanation", phase: "rule", language: input.nativeLanguage, text: `Hold onto this: ${paradigm.mnemonic}`, delivery: "clear" });

  const drills = paradigm.practice;
  const slots = scheduleReviewSlots(drills.length, Math.min(12, drills.length));
  const after = new Map<number, number[]>();
  const ending: number[] = [];
  for (const slot of slots) {
    if (slot.afterItem >= drills.length) ending.push(slot.item);
    else after.set(slot.afterItem, [...(after.get(slot.afterItem) ?? []), slot.item]);
  }
  let pluralOpen = false;
  const pose = (item: Practice, phase: string, salt: number): void => {
    const translation = disambiguateTranslation(item.translation, item.answer, input.targetLanguage);
    const start = item.mode === "produce" || phase === "review" ? salt : 0;
    ask(phase, takeCue(practiceCues(item, translation, input.targetLanguage), used, start), { text: item.answer, translation, language: input.targetLanguage });
  };
  drills.forEach((drill, index) => {
    if (drill.half === "plural" && !pluralOpen) {
      pluralOpen = true;
      push({ kind: "narration", phase: "bridge", language: input.nativeLanguage, text: paradigm.pluralBridge, delivery: "warm" });
      paradigm.pluralExamples.forEach((example) => show(example, "example"));
      ask("notice", paradigm.pluralQuestion, { text: paradigm.pluralInsight, language: input.nativeLanguage }, NOTICE_PAUSE_MS);
      push({ kind: "explanation", phase: "rule", language: input.nativeLanguage, text: paradigm.pluralRule, delivery: "clear" });
    }
    pose(drill, drill.mode === "produce" && index > drills.length - 3 ? "recombine" : "practice", index);
    for (const earlier of after.get(index) ?? []) {
      const item = drills[earlier];
      if (item) pose(item, "review", index + earlier + 3);
    }
    if (index === 4 && paradigm.checks[0]) ask("check", paradigm.checks[0].cue, { text: paradigm.checks[0].answer, language: input.nativeLanguage });
    if (pluralOpen && index === drills.findIndex((item) => item.half === "plural") + 3 && paradigm.checks[1]) {
      ask("check", paradigm.checks[1].cue, { text: paradigm.checks[1].answer, language: input.nativeLanguage });
    }
  });
  for (const line of paradigm.recap) {
    push({ kind: "recap", phase: "summary", language: input.nativeLanguage, text: line, delivery: "clear" });
  }
  const quick = [...ending, 0, drills.findIndex((item) => item.half === "plural")].filter((index, position, all) => index >= 0 && all.indexOf(index) === position).slice(0, 3);
  for (const index of quick) {
    const item = drills[index];
    if (item) pose(item, "review", index + 6);
  }
  if (paradigm.checks[2]) ask("check", paradigm.checks[2].cue, { text: paradigm.checks[2].answer, language: input.nativeLanguage });
  push({ kind: "recap", phase: "closing", language: input.nativeLanguage, text: paradigm.closing, delivery: "praise" });
  return spokenLesson(segments);
}

export function grammarPromptsAreClear(segments: LessonSegment[]): boolean {
  for (let index = 0; index < segments.length; index += 1) {
    const prompt = segments[index];
    if (!prompt?.pauseAfterMs) continue;
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
  const paradigm = PARADIGMS[context.topic.id];
  if (paradigm) {
    const teacherName = value && typeof value === "object"
      ? normalizeSpeakerNames((value as { speakerNames?: unknown }).speakerNames).teacher
      : "Mira";
    const segments = arrangeParadigm(paradigm, {
      nativeLanguage: context.nativeLanguage,
      targetLanguage: context.targetLanguage,
    });
    return {
      title: paradigm.title,
      topic: context.topic.title.slice(0, 160),
      ruleId: context.topic.id,
      summary: paradigm.summary,
      speakerNames: normalizeSpeakerNames({ teacher: teacherName }),
      segments,
    };
  }
  const source = parseGrammarSource(value, context.topic, context.level);
  if (!source) return null;
  const arranged = arrangeGrammarLesson({
    source,
    nativeLanguage: context.nativeLanguage,
    targetLanguage: context.targetLanguage,
  });
  if (arranged.some((segment) => segment.speaker !== "teacher")) return null;
  const affixes = arranged
    .filter((segment) => segment.language === context.nativeLanguage)
    .flatMap((segment) => lessonDisplayText(segment.text).match(
      /(?<![\p{L}\p{M}\p{N}\p{Pd}])(?:[-‐][\p{L}\p{M}]+|[\p{L}\p{M}]+[-‐])(?![\p{L}\p{M}\p{N}\p{Pd}])/gu,
    ) ?? []);
  const { segments, leftover } = applyTargetVoices(arranged, context.nativeLanguage, context.targetLanguage, [
    ...(source.targetTerms ?? []), ...affixes,
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
