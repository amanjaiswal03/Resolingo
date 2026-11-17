import type { LanguageId } from "./languages.js";
import type { CefrLevel, LessonSegment } from "./schemas.js";
import { MAX_LESSON_SEGMENTS } from "./schemas.js";
import { languageById } from "./languages.js";
import { lessonDisplayText, repairMarkup } from "./markup.js";
import { ANSWER_PAUSE_MS, REVIEW_GAPS } from "./pimsleur.js";
import { normalizeSpeakerNames, type SpeakerNames } from "./speakers.js";

/** Lookups kept on the profile. Older ones are deleted on the next save. */
export const MAX_STORED_PHRASES = 100;
export const PHRASE_LOOKUP_LIMIT = 30;
export const PHRASE_LOOKUP_UNLIMITED = 100;
/** The same target sentence is modeled and asked only a handful of times. */
export const MAX_IDENTICAL_PHRASE_ANSWERS = 5;

const SPEAK_FRAMES = [
  "How would you say {translation}?",
  "Can you say {translation}?",
  "Try saying {translation}.",
  "Give it a try: {translation}.",
  "Your turn: {translation}.",
  "Say it out loud: {translation}.",
  "Now you say it: {translation}.",
] as const;

const SWAP_FRAMES = [
  "Now, instead of {from}, {to}. How would you say {translation}?",
  "This time it's {to}, not {from}. Can you say {translation}?",
  "Same idea, but {to}. Try saying {translation}.",
  "Keep the sentence, and use {to}. Your turn: {translation}.",
] as const;

const MAX_IDENTICAL_CUES = 2;
/** A gloss longer than this is a whole sentence, not a new word. */
const MAX_GLOSS_WORDS = 3;

const QUICK_FRAMES = [
  "Quick check. How would you say {translation}?",
  "One more. Can you say {translation}?",
  "And the line you came in with. Try saying {translation}.",
] as const;

export type PhraseAlternative = { label: string; text: string; transliteration?: string; words?: PhraseLine[] };
export type PhraseLine = { text: string; translation: string };
export type PhraseSwap = {
  from: string;
  to: string;
  answer: string;
  translation: string;
  /** New target word, with its article, taught before the sentence. */
  focus: string;
  focusTranslation: string;
  usage?: string;
  /** Other new words in the answer, each glossed on its own. */
  words?: PhraseLine[];
};
export type PhraseSituation = {
  setup: string;
  answer: string;
  translation: string;
  focus: string;
  focusTranslation: string;
  usage?: string;
  words?: PhraseLine[];
};

export type PhraseLessonContext = {
  phraseId: string;
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
  level: CefrLevel;
  nativeText: string;
  translation: string;
  transliteration?: string;
  alternatives?: PhraseAlternative[];
  /** Literal gloss for an idiom. Spoken once. Never used as the line to drill. */
  note?: string;
  inputLanguage?: "native" | "target" | "mixed" | "unknown";
  priorReviews?: PhraseLine[];
};

type Drill = {
  kind: "chunk" | "phrase" | "swap" | "situation" | "roleplay";
  answer: string;
  translation: string;
  cues: string[];
  setup?: string;
  focus?: string;
  focusTranslation?: string;
  usage?: string;
  words?: PhraseLine[];
  transliteration?: string;
};

/**
 * Same pace the lesson audio already uses. A1 and A2 stay slow; B1 eases off.
 * Phrase lessons pass the learner's level through to that speech path.
 */
export function phraseLessonPace(level: CefrLevel): "slow" | "moderate" | "natural" {
  if (level === "A1" || level === "A2") return "slow";
  if (level === "B1") return "moderate";
  return "natural";
}

export function phraseLookupLimit(unlimitedLessons: unknown): number {
  return unlimitedLessons === true ? PHRASE_LOOKUP_UNLIMITED : PHRASE_LOOKUP_LIMIT;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function hashKey(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Cache id for one learner query. The English frame in the placeholder does not create a second phrase. */
export function normalizePhraseQuery(text: string): string {
  return normalize(text.replace(/^\s*how would you say\b[:\s]*/i, ""));
}

export function phraseIdFor(targetLanguage: string, level: string, query: string): string {
  return `phrase_${hashKey(`${targetLanguage}:${level}:${normalizePhraseQuery(query)}`)}`;
}

export function phraseIdsToPrune(idsNewestFirst: readonly string[], keep = MAX_STORED_PHRASES): string[] {
  return idsNewestFirst.slice(keep);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function meaningOf(value: string): string {
  return value.replace(/[.!?？。]+$/u, "").trim();
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function same(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function linesOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function gloss(text: string, translation: string, language: LanguageId): string {
  return `[[lang:${language}]]${meaningOf(text)}[[/lang]] means "${meaningOf(translation)}".`;
}

function contentWords(text: string): string[] {
  return normalize(text).split(" ").filter((word) => word.length >= 3);
}

/** The words a gloss or same-word note actually teaches, ignoring a full-sentence translation. */
function taughtWords(segment: LessonSegment): string[] {
  const shown = lessonDisplayText(segment.text);
  const sameWord = shown.match(/^(.+?)\s+is the same word\b/i);
  const means = shown.match(/^(.+?)\s+means\s+["“]/i);
  const span = (sameWord?.[1] ?? means?.[1] ?? "").trim();
  if (!span) return [];
  const words = contentWords(span);
  if (words.length === 0 || words.length > MAX_GLOSS_WORDS) return [];
  return words;
}

function produceCues(translation: string): string[] {
  const meaning = meaningOf(translation);
  return SPEAK_FRAMES.map((frame) => frame.replaceAll("{translation}", meaning));
}

function swapCues(swap: PhraseSwap): string[] {
  const meaning = meaningOf(swap.translation);
  return SWAP_FRAMES.map((frame) => frame
    .replaceAll("{from}", swap.from)
    .replaceAll("{to}", swap.to)
    .replaceAll("{translation}", meaning));
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

function budget(level: CefrLevel): { chunks: number; swaps: number; situations: number; reviews: number } {
  if (level === "A1") return { chunks: 3, swaps: 2, situations: 2, reviews: 3 };
  if (level === "A2") return { chunks: 3, swaps: 2, situations: 3, reviews: 4 };
  return { chunks: 0, swaps: 2, situations: 3, reviews: 4 };
}

function readWords(value: unknown): PhraseLine[] {
  const words: PhraseLine[] = [];
  for (const record of linesOf(value)) {
    const text = textOf(record.text);
    const translation = textOf(record.translation);
    if (!text || !translation || words.some((word) => same(word.text, text))) continue;
    words.push({ text, translation });
  }
  return words;
}

function readChunks(value: unknown, core: string): PhraseLine[] {
  const chunks: PhraseLine[] = [];
  for (const record of linesOf(value)) {
    const text = textOf(record.text);
    const translation = textOf(record.translation);
    if (!text || !translation || same(text, core)) continue;
    if (chunks.some((chunk) => same(chunk.text, text))) continue;
    chunks.push({ text, translation });
  }
  return chunks;
}

function readSwaps(value: unknown, core: string): PhraseSwap[] {
  const swaps: PhraseSwap[] = [];
  for (const record of linesOf(value)) {
    const answer = textOf(record.answer);
    const translation = textOf(record.translation);
    const from = textOf(record.from);
    const to = textOf(record.to);
    const focus = textOf(record.focus);
    const focusTranslation = textOf(record.focusTranslation);
    if (!answer || !translation || !from || !to || !focus || !focusTranslation) continue;
    if (same(from, to) || same(answer, core) || same(focus, core)) continue;
    if (swaps.some((swap) => same(swap.answer, answer))) continue;
    const usage = textOf(record.usage);
    const words = readWords(record.words);
    swaps.push({
      from, to, answer, translation, focus, focusTranslation,
      ...(usage ? { usage } : {}),
      ...(words.length > 0 ? { words } : {}),
    });
  }
  return swaps;
}

function readSituations(value: unknown, core: string): PhraseSituation[] {
  const situations: PhraseSituation[] = [];
  for (const record of linesOf(value)) {
    const setup = textOf(record.setup);
    const answer = textOf(record.answer);
    const translation = textOf(record.translation);
    const focus = textOf(record.focus);
    const focusTranslation = textOf(record.focusTranslation);
    if (!setup || !answer || !translation || !focus || !focusTranslation) continue;
    if (same(answer, core) || situations.some((item) => same(item.answer, answer))) continue;
    const usage = textOf(record.usage);
    const words = readWords(record.words);
    situations.push({
      setup, answer, translation, focus, focusTranslation,
      ...(usage ? { usage } : {}),
      ...(words.length > 0 ? { words } : {}),
    });
  }
  return situations;
}

function isLiteral(answer: string, note: string | undefined): boolean {
  if (!note) return false;
  return same(answer, note) || normalize(answer).includes(normalize(note));
}

/**
 * A paused prompt has to name the meaning the learner should say.
 * A bare "Say it out loud" is not enough.
 */
export function phrasePromptsAreClear(segments: LessonSegment[]): boolean {
  for (let index = 0; index < segments.length; index += 1) {
    const prompt = segments[index];
    if (!prompt?.pauseAfterMs) continue;
    const answer = segments[index + 1];
    if (!answer || prompt.speaker !== "teacher" || answer.speaker !== "teacher") return false;
    const meaning = meaningOf(answer.translation ?? "");
    if (meaning.length < 2 || !prompt.text.toLocaleLowerCase().includes(meaning.toLocaleLowerCase())) return false;
  }
  return true;
}

/** Consecutive lines must not repeat, and a setup must not be glued onto the next prompt. */
export function phraseLinesAreDistinct(segments: readonly LessonSegment[]): boolean {
  for (let index = 1; index < segments.length; index += 1) {
    const previous = lessonDisplayText(segments[index - 1]?.text ?? "");
    const current = lessonDisplayText(segments[index]?.text ?? "");
    if (!previous || !current || same(previous, current)) return false;
    const gloss = /means\s+["“]/i.test(previous) || /means\s+["“]/i.test(current);
    if (gloss) continue;
    const left = previous.toLocaleLowerCase();
    const right = current.toLocaleLowerCase();
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length <= right.length ? right : left;
    if (shorter.length >= 24 && longer.startsWith(shorter)) return false;
  }
  return true;
}

/** A new word is glossed before any pause that asks the learner to say a line containing it. */
export function focusesAreGlossedFirst(segments: readonly LessonSegment[], focuses: readonly string[]): boolean {
  for (const focus of focuses) {
    const needle = normalize(focus);
    if (needle.length < 2) continue;
    const glossAt = segments.findIndex((segment) => {
      const teaches = /means\s+["“]/i.test(segment.text) || /is the same word/i.test(segment.text);
      return teaches && normalize(lessonDisplayText(segment.text)).includes(needle);
    });
    const produceAt = segments.findIndex((segment, index) => {
      const previous = segments[index - 1];
      return (previous?.pauseAfterMs ?? 0) > 0 && normalize(segment.text).includes(needle);
    });
    if (produceAt >= 0 && (glossAt < 0 || glossAt > produceAt)) return false;
  }
  return true;
}

/**
 * A content word in a required answer has to be in the core sentence or in an
 * earlier short gloss. Translating the whole answer does not teach a new word.
 */
export function answerWordsAreGlossed(segments: readonly LessonSegment[], language: LanguageId, core: string): boolean {
  const known = new Set(contentWords(core));
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const previous = segments[index - 1];
    if ((previous?.pauseAfterMs ?? 0) > 0 && segment?.language === language && segment.phase !== "warmup") {
      for (const word of contentWords(segment.text)) {
        if (!known.has(word)) return false;
      }
    }
    if (segment) {
      for (const word of taughtWords(segment)) known.add(word);
    }
  }
  return true;
}

export function phraseAnswersStayVaried(segments: readonly LessonSegment[], language: LanguageId): boolean {
  const counts = new Map<string, number>();
  for (const segment of segments) {
    if (segment.language !== language) continue;
    const key = normalize(segment.text);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if ((counts.get(key) ?? 0) > MAX_IDENTICAL_PHRASE_ANSWERS) return false;
  }
  return true;
}

function introFor(context: PhraseLessonContext, targetLabel: string): string {
  const meaning = meaningOf(context.nativeText);
  if (context.inputLanguage === "target") {
    return `You already said this in ${targetLabel}. It means "${meaning}". We'll practice it in a few real situations.`;
  }
  if (context.inputLanguage === "mixed") {
    return `Part of that was already in ${targetLabel}. The whole sentence means "${meaning}". Let's learn it as one line.`;
  }
  return `You wanted to say "${meaning}". Here's how that sounds in ${targetLabel}.`;
}

function closingFor(situations: readonly PhraseSituation[]): string {
  const clerk = situations.find((item) => /\b(clerk|shop)\b/i.test(item.setup));
  const friend = situations.find((item) => /\bfriend\b/i.test(item.setup));
  const lines = ["Nice work."];
  if (clerk) lines.push(`With a clerk, use the line that means "${meaningOf(clerk.translation)}".`);
  if (friend && friend !== clerk) lines.push(`With a friend, use the line that means "${meaningOf(friend.translation)}".`);
  if (!clerk && !friend && situations[0]) lines.push(`Use the line that means "${meaningOf(situations[0].translation)}" when it fits.`);
  return lines.join(" ");
}

export function shapePhraseLesson(
  value: unknown,
  context: PhraseLessonContext,
): { title: string; topic: string; ruleId: string; summary: string; speakerNames: SpeakerNames; segments: LessonSegment[] } | null {
  const core = context.translation.trim();
  const meaning = meaningOf(context.nativeText);
  if (core.length < 1 || meaning.length < 1 || context.phraseId.trim().length === 0 || context.phraseId.length > 40) return null;
  const source = asRecord(value) ?? {};
  const limits = budget(context.level);
  const note = textOf(context.note);
  const pattern = textOf(source.pattern).split(/(?<=[.!?])\s+/u)[0]?.trim() ?? "";
  const chunks = context.level === "A1" || context.level === "A2"
    ? readChunks(source.chunks, core).slice(0, limits.chunks)
    : [];
  const swaps = readSwaps(source.swaps, core).filter((swap) => !isLiteral(swap.answer, note)).slice(0, limits.swaps);
  if (swaps.length < limits.swaps) return null;
  const chosenSituations = readSituations(source.situations, core).filter((item) => !isLiteral(item.answer, note)).slice(0, limits.situations);
  if (chosenSituations.length < limits.situations) return null;
  for (const alternative of context.alternatives ?? []) {
    if (chosenSituations.some((item) => same(item.answer, alternative.text)) || same(alternative.text, core)) continue;
    if (isLiteral(alternative.text, note)) continue;
    chosenSituations.push({
      setup: "You want to sound a bit more formal.",
      answer: alternative.text,
      translation: `${meaning}, ${alternative.label}`,
      focus: alternative.text,
      focusTranslation: `${meaning}, ${alternative.label}`,
      usage: "A more formal way to say it.",
      ...(alternative.words && alternative.words.length > 0 ? { words: alternative.words } : {}),
    });
    break;
  }
  const roleRecord = asRecord(source.roleplay);
  const roleSetup = textOf(roleRecord?.setup) || chosenSituations[0]!.setup;
  const requestedRole = textOf(roleRecord?.answer);
  const roleSituation = chosenSituations.find((item) => same(item.answer, requestedRole)) ?? chosenSituations[0]!;
  if (isLiteral(roleSituation.answer, note) || same(roleSituation.answer, core)) return null;

  const drills: Drill[] = [
    {
      kind: "phrase",
      answer: core,
      translation: meaning,
      cues: produceCues(meaning),
      ...(context.transliteration ? { transliteration: context.transliteration } : {}),
    },
    ...swaps.map((swap) => ({
      kind: "swap" as const,
      answer: swap.answer,
      translation: meaningOf(swap.translation),
      cues: swapCues(swap),
      focus: swap.focus,
      focusTranslation: swap.focusTranslation,
      ...(swap.usage ? { usage: swap.usage } : {}),
      ...(swap.words ? { words: swap.words } : {}),
    })),
    ...chosenSituations.map((situation) => ({
      kind: "situation" as const,
      setup: situation.setup,
      answer: situation.answer,
      translation: meaningOf(situation.translation),
      cues: produceCues(situation.translation),
      focus: situation.focus,
      focusTranslation: situation.focusTranslation,
      ...(situation.usage ? { usage: situation.usage } : {}),
      ...(situation.words ? { words: situation.words } : {}),
    })),
    {
      kind: "roleplay" as const,
      setup: roleSetup,
      answer: roleSituation.answer,
      translation: meaningOf(roleSituation.translation),
      cues: produceCues(roleSituation.translation),
    },
  ];

  const segments: LessonSegment[] = [];
  const used = new Map<string, number>();
  const spoken = new Map<string, number>();
  let ordinal = 0;
  const heard = (text: string): number => spoken.get(normalize(text)) ?? 0;
  const canSay = (text: string): boolean => heard(text) < MAX_IDENTICAL_PHRASE_ANSWERS;
  const mark = (text: string): void => {
    const key = normalize(text);
    spoken.set(key, (spoken.get(key) ?? 0) + 1);
  };
  const push = (segment: Omit<LessonSegment, "id" | "speaker" | "delivery"> & { delivery?: LessonSegment["delivery"] }, pauseMs = 0): boolean => {
    if (segments.length >= MAX_LESSON_SEGMENTS) return false;
    const text = repairMarkup(segment.text).trim();
    if (!text) return false;
    const previous = lessonDisplayText(segments.at(-1)?.text ?? "");
    const shown = lessonDisplayText(text);
    if (previous && same(previous, shown)) return false;
    if (segment.language === context.targetLanguage && !canSay(text)) return false;
    ordinal += 1;
    segments.push({
      id: `seg_${String(ordinal).padStart(2, "0")}`,
      speaker: "teacher",
      delivery: segment.delivery ?? "warm",
      ...segment,
      text,
      ...(pauseMs > 0 ? { pauseAfterMs: pauseMs } : {}),
    });
    if (segment.language === context.targetLanguage) mark(text);
    return true;
  };
  const ask = (drill: Pick<Drill, "answer" | "translation" | "cues" | "transliteration">, phase: string, salt: number): void => {
    if (!canSay(drill.answer) || segments.length + 2 > MAX_LESSON_SEGMENTS - 8) return;
    if (phase === "review" && heard(drill.answer) >= 3) return;
    const cue = takeCue(drill.cues, used, salt);
    if (!cue) return;
    const answerPhase = phase === "practice" ? "answer" : phase;
    const before = segments.length;
    push({ kind: "drill", phase, language: context.nativeLanguage, text: cue, delivery: "curious" }, ANSWER_PAUSE_MS);
    const placed = push({
      kind: "drill",
      phase: answerPhase,
      language: context.targetLanguage,
      text: drill.answer,
      translation: meaningOf(drill.translation),
      ...(drill.transliteration ? { transliteration: drill.transliteration } : {}),
      delivery: "clear",
    });
    if (!placed && segments.length > before) segments.pop();
  };
  const teach = (word: string, translation: string, phase: string, repeat: boolean, usage?: string): void => {
    if (!word || !translation) return;
    push({ kind: "example", phase, language: context.targetLanguage, text: word, translation: meaningOf(translation), delivery: "clear" });
    const note = same(word, translation)
      ? `${meaningOf(word)} is the same word.`
      : gloss(word, translation, context.targetLanguage);
    push({ kind: "explanation", phase, language: context.nativeLanguage, text: note, delivery: "clear" });
    if (usage) push({ kind: "explanation", phase, language: context.nativeLanguage, text: usage, delivery: "clear" });
    if (!repeat || same(word, core)) return;
    ask({ answer: word, translation, cues: produceCues(translation) }, "focus", 1);
  };

  const targetLabel = languageById[context.targetLanguage].label;
  const teacherName = normalizeSpeakerNames(source.speakerNames).teacher;
  push({ kind: "narration", phase: "intro", language: context.nativeLanguage, text: introFor(context, targetLabel), delivery: "warm" });
  (context.priorReviews ?? []).slice(0, 2).forEach((review, index) => {
    ask({ answer: review.text, translation: review.translation, cues: produceCues(review.translation) }, "warmup", index + 1);
  });
  push({ kind: "narration", phase: "hook", language: context.nativeLanguage, text: "Listen once, then we'll build it and try it in a few places.", delivery: "warm" });
  push({
    kind: "example",
    phase: "hook",
    language: context.targetLanguage,
    text: core,
    translation: meaning,
    ...(context.transliteration ? { transliteration: context.transliteration } : {}),
    delivery: "clear",
  });
  push({ kind: "explanation", phase: "hook", language: context.nativeLanguage, text: gloss(core, meaning, context.targetLanguage), delivery: "clear" });
  if (note && !same(note, meaning) && !same(note, core)) {
    push({ kind: "explanation", phase: "note", language: context.nativeLanguage, text: note, delivery: "clear" });
    push({ kind: "explanation", phase: "note", language: context.nativeLanguage, text: "We'll practice the natural sentence, not the word-for-word version.", delivery: "clear" });
  }
  if (chunks.length > 0) {
    push({ kind: "narration", phase: "chunk", language: context.nativeLanguage, text: "We'll take it in pieces, starting from the end.", delivery: "warm" });
    chunks.forEach((chunk) => teach(chunk.text, chunk.translation, "chunk", true));
  }
  if (pattern) {
    push({ kind: "explanation", phase: "pattern", language: context.nativeLanguage, text: pattern, delivery: "clear" });
  }
  const phraseDrill = drills[0]!;
  ask(phraseDrill, "practice", 0);

  const reviewed = new Set<number>();
  let reviewCount = 0;
  drills.forEach((drill, index) => {
    if (index === 0) return;
    if (drill.focus && drill.focusTranslation && !same(drill.focus, drill.answer)) {
      teach(drill.focus, drill.focusTranslation, drill.kind, true);
      for (const word of drill.words ?? []) {
        if (!same(word.text, drill.focus)) teach(word.text, word.translation, drill.kind, true);
      }
      if (drill.kind === "situation") {
        push({ kind: "example", phase: drill.kind, language: context.targetLanguage, text: drill.answer, translation: drill.translation, delivery: "clear" });
        push({ kind: "explanation", phase: drill.kind, language: context.nativeLanguage, text: gloss(drill.answer, drill.translation, context.targetLanguage), delivery: "clear" });
      }
      if (drill.usage) push({ kind: "explanation", phase: drill.kind, language: context.nativeLanguage, text: drill.usage, delivery: "clear" });
    } else if (drill.focus && drill.focusTranslation) {
      for (const word of drill.words ?? []) teach(word.text, word.translation, drill.kind, true);
      push({ kind: "example", phase: drill.kind, language: context.targetLanguage, text: drill.answer, translation: drill.translation, delivery: "clear" });
      const sentenceNote = same(drill.focus, drill.focusTranslation)
        ? `${meaningOf(drill.focus)} is the same word.`
        : gloss(drill.focus, drill.focusTranslation, context.targetLanguage);
      push({ kind: "explanation", phase: drill.kind, language: context.nativeLanguage, text: sentenceNote, delivery: "clear" });
      if (drill.usage) push({ kind: "explanation", phase: drill.kind, language: context.nativeLanguage, text: drill.usage, delivery: "clear" });
    }
    if (drill.setup) {
      push({ kind: "narration", phase: drill.kind, language: context.nativeLanguage, text: drill.setup, delivery: "warm" });
    }
    const phase = drill.kind === "roleplay" ? "roleplay" : "practice";
    ask(drill, phase, drill.kind === "swap" ? index - 1 : index);
    if (reviewCount >= limits.reviews) return;
    for (const gap of REVIEW_GAPS) {
      const earlier = index - gap;
      if (earlier < 0 || reviewed.has(earlier)) continue;
      const item = drills[earlier];
      if (!item || same(item.answer, drill.answer)) continue;
      const before = segments.length;
      ask(item, "review", index + earlier + 2);
      if (segments.length === before) continue;
      reviewed.add(earlier);
      reviewCount += 1;
      break;
    }
  });

  const quickItems = [
    swaps[0] ? { answer: swaps[0].answer, translation: swaps[0].translation } : null,
    chosenSituations.find((item) => /\bfriend\b/i.test(item.setup))
      ?? chosenSituations.find((item) => !same(item.answer, roleSituation.answer))
      ?? null,
    { answer: core, translation: meaning },
  ].filter((item): item is { answer: string; translation: string } => Boolean(item));
  quickItems.slice(0, 3).forEach((item, index) => {
    const frame = QUICK_FRAMES[index] ?? QUICK_FRAMES[0];
    ask({
      answer: item.answer,
      translation: item.translation,
      cues: [frame.replaceAll("{translation}", meaningOf(item.translation))],
    }, "quick", index);
  });

  push({ kind: "recap", phase: "summary", language: context.nativeLanguage, text: `The sentence you wanted is the one that means "${meaning}".`, delivery: "clear" });
  push({ kind: "recap", phase: "summary", language: context.targetLanguage, text: core, translation: meaning, delivery: "clear" });
  const swapLine = swaps[0];
  if (swapLine) {
    push({ kind: "recap", phase: "summary", language: context.nativeLanguage, text: `To change ${swapLine.from} to ${swapLine.to}, you say the new sentence like this.`, delivery: "clear" });
    push({ kind: "recap", phase: "summary", language: context.targetLanguage, text: swapLine.answer, translation: meaningOf(swapLine.translation), delivery: "clear" });
  }
  const polite = chosenSituations.find((item) => /\b(clerk|shop)\b/i.test(item.setup)) ?? roleSituation;
  push({ kind: "recap", phase: "summary", language: context.nativeLanguage, text: `With a clerk, the polite version means "${meaningOf(polite.translation)}", and it sounds like this.`, delivery: "clear" });
  push({ kind: "recap", phase: "summary", language: context.targetLanguage, text: polite.answer, translation: meaningOf(polite.translation), delivery: "clear" });
  push({ kind: "recap", phase: "closing", language: context.nativeLanguage, text: closingFor(chosenSituations), delivery: "praise" });

  const focuses = [
    ...chunks.map((chunk) => chunk.text),
    ...swaps.map((swap) => swap.focus),
    ...chosenSituations.map((situation) => situation.focus),
  ];
  if (
    segments.length < 8
    || segments.some((segment) => segment.speaker !== "teacher")
    || !phrasePromptsAreClear(segments)
    || !phraseLinesAreDistinct(segments)
    || !focusesAreGlossedFirst(segments, focuses)
    || !phraseAnswersStayVaried(segments, context.targetLanguage)
    || !answerWordsAreGlossed(segments, context.targetLanguage, core)
    || segments.filter((segment) => segment.phase === "pattern").length > 1
  ) return null;
  const title = clip(textOf(source.title) || `Saying: ${meaning}`, 90);
  const topic = clip(textOf(source.topic) || meaning, 160);
  const summary = clip(textOf(source.summary) || `Practice how to say "${meaning}" and a few variations.`, 280);
  if (title.length < 3 || topic.length < 3 || summary.length < 5) return null;
  return {
    title,
    topic,
    ruleId: context.phraseId,
    summary,
    speakerNames: normalizeSpeakerNames({ teacher: teacherName }),
    segments,
  };
}
