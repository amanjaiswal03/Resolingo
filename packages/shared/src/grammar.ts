import type { LanguageId } from "./languages.js";
import type { CefrLevel } from "./schemas.js";
import { repairMarkup } from "./markup.js";
import {
  ANSWER_PAUSE_MS,
  MAX_PIMSLEUR_SEGMENTS,
  scheduleReviewSlots,
} from "./pimsleur.js";
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
  return rows.map((row, index) => ({
    ...row,
    level,
    prerequisites: rows.slice(0, index).map((earlier) => earlier.title),
  }));
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
  exception?: string;
  drills: Drill[];
  checks: RuleCheck[];
  recombinations: Drill[];
  priorReviews: Example[];
};

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function meaningOf(value: string): string {
  return value.replace(/[.!?？。]+$/u, "").trim();
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
    const key = item.text.toLocaleLowerCase();
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
      return cue && answer ? { cue: cue.slice(0, 220), answer: answer.slice(0, 180) } : null;
    })
    .filter((item): item is RuleCheck => Boolean(item))
    .slice(0, 2);
  const rule = textOf(record.rule) || textOf(record.summary);
  const mnemonic = textOf(record.mnemonic) || rule.split(/[.。]/u)[0]?.trim() || rule;
  if (!rule || !mnemonic) return null;
  const exception = textOf(record.exception);
  const names = normalizeSpeakerNames(record.speakerNames);
  const title = textOf(record.title) || topic.title;
  return {
    title: title.slice(0, 90),
    topic,
    summary: (textOf(record.summary) || topic.focus).slice(0, 280),
    teacherName: names.teacher,
    hook,
    examples,
    notice: textOf(record.notice) || rule,
    rule: rule.slice(0, 320),
    mnemonic: mnemonic.slice(0, 160),
    ...(exception && grammarLevelAllowsException(level) ? { exception: exception.slice(0, 180) } : {}),
    drills,
    checks: checks.length > 0 ? checks : [{ cue: "What is the pattern?", answer: mnemonic.slice(0, 180) }],
    recombinations,
    priorReviews: [],
  };
}

function gloss(example: Example, language: LanguageId): string {
  return `[[lang:${language}]]${example.text}[[/lang]] means "${meaningOf(example.translation)}".`.slice(0, 400);
}

export function arrangeGrammarLesson(input: {
  source: GrammarSource;
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
  priorReviews?: Example[];
}): LessonSegment[] {
  const segments: LessonSegment[] = [];
  let ordinal = 0;
  const push = (segment: Omit<LessonSegment, "id" | "speaker" | "delivery"> & { delivery?: LessonSegment["delivery"] }, pauseMs = 0): boolean => {
    if (segments.length >= MAX_PIMSLEUR_SEGMENTS) return false;
    if (segments.at(-1)?.text === segment.text) return true;
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
  const ask = (phase: string, cue: string, answer: { text: string; translation?: string; language: LanguageId }, pause = ANSWER_PAUSE_MS): void => {
    if (segments.length + 2 > MAX_PIMSLEUR_SEGMENTS - 4) return;
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

  push({ kind: "narration", phase: "intro", language: input.nativeLanguage, text: `Welcome. Today the pattern is ${input.source.topic.title}.`, delivery: "warm" });
  for (const review of (input.priorReviews ?? []).slice(0, 2)) {
    ask("warmup", `How would you say ${meaningOf(review.translation)}?`, { ...review, language: input.targetLanguage });
  }

  push({ kind: "narration", phase: "hook", language: input.nativeLanguage, text: "Listen for the pattern in a real sentence.", delivery: "warm" });
  push({ kind: "example", phase: "hook", language: input.targetLanguage, text: input.source.hook.text, translation: input.source.hook.translation, delivery: "clear" });
  push({ kind: "explanation", phase: "hook", language: input.nativeLanguage, text: gloss(input.source.hook, input.targetLanguage), delivery: "clear" });

  input.source.examples.slice(0, 3).forEach((example) => {
    push({ kind: "example", phase: "example", language: input.targetLanguage, text: example.text, translation: example.translation, delivery: "clear" });
    push({ kind: "explanation", phase: "example", language: input.nativeLanguage, text: gloss(example, input.targetLanguage), delivery: "clear" });
  });
  ask("notice", "What stays the same, and what changes?", { text: input.source.notice, language: input.nativeLanguage }, NOTICE_PAUSE_MS);

  push({ kind: "explanation", phase: "rule", language: input.nativeLanguage, text: input.source.rule, delivery: "clear" });
  push({ kind: "explanation", phase: "rule", language: input.nativeLanguage, text: `Remember it like this: ${input.source.mnemonic}`, delivery: "clear" });
  if (input.source.exception) {
    push({ kind: "explanation", phase: "rule", language: input.nativeLanguage, text: `One common exception: ${input.source.exception}`, delivery: "clear" });
  }

  const drills = input.source.drills;
  const slots = scheduleReviewSlots(drills.length, Math.min(8, drills.length));
  const after = new Map<number, number[]>();
  const ending: number[] = [];
  for (const slot of slots) {
    if (slot.afterItem >= drills.length) ending.push(slot.item);
    else after.set(slot.afterItem, [...(after.get(slot.afterItem) ?? []), slot.item]);
  }
  drills.forEach((drill, index) => {
    ask("practice", drillCue(drill), { text: drill.answer, translation: drill.translation, language: input.targetLanguage });
    for (const earlier of after.get(index) ?? []) {
      const item = drills[earlier];
      if (item) ask("review", drillCue(item), { text: item.answer, translation: item.translation, language: input.targetLanguage });
    }
    if (index === 2 && input.source.checks[0]) {
      ask("check", input.source.checks[0].cue, { text: input.source.checks[0].answer, language: input.nativeLanguage });
    }
  });
  for (const fresh of input.source.recombinations) {
    ask("recombine", drillCue(fresh), { text: fresh.answer, translation: fresh.translation, language: input.targetLanguage });
  }
  push({ kind: "recap", phase: "summary", language: input.nativeLanguage, text: `${input.source.rule} ${input.source.mnemonic}`.slice(0, 400), delivery: "clear" });
  const quick = [...ending, 0, Math.min(1, drills.length - 1)].filter((index, position, all) => all.indexOf(index) === position).slice(0, 3);
  for (const index of quick) {
    const item = drills[index];
    if (item) ask("review", drillCue(item), { text: item.answer, translation: item.translation, language: input.targetLanguage });
  }
  if (input.source.checks[1]) ask("check", input.source.checks[1].cue, { text: input.source.checks[1].answer, language: input.nativeLanguage });
  push({ kind: "recap", phase: "closing", language: input.nativeLanguage, text: "That is the pattern. Use it the next time you speak.", delivery: "praise" });

  return segments.map((segment) => ({ ...segment, text: repairMarkup(segment.text).trim() || segment.text }));
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
  priorReviews?: Example[];
}): { title: string; topic: string; ruleId: string; summary: string; speakerNames: SpeakerNames; segments: LessonSegment[] } | null {
  const source = parseGrammarSource(value, context.topic, context.level);
  if (!source) return null;
  const segments = arrangeGrammarLesson({
    source,
    nativeLanguage: context.nativeLanguage,
    targetLanguage: context.targetLanguage,
    ...(context.priorReviews ? { priorReviews: context.priorReviews } : {}),
  });
  if (segments.some((segment) => segment.speaker !== "teacher")) return null;
  return {
    title: source.title,
    topic: context.topic.title.slice(0, 160),
    ruleId: context.topic.id,
    summary: source.summary,
    speakerNames: normalizeSpeakerNames({ teacher: source.teacherName }),
    segments,
  };
}
