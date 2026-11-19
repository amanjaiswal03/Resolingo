import type { LanguageId } from "./languages.js";
import type { CefrLevel, LessonSegment } from "./schemas.js";
import { MAX_LESSON_SEGMENTS } from "./schemas.js";
import { languageById } from "./languages.js";
import { applyTargetVoices, lessonDisplayText, repairMarkup } from "./markup.js";
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
  /** Ignored. Phrases from earlier lessons are recalled only in conversation lessons. */
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

/** New content words in an alternative, grouped into short glosses of at most three words. */
function novelFocuses(answer: string, core: string): string[] {
  const known = new Set(spokenWords(core));
  const tokens = answer
    .split(/\s+/u)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => token.length > 0);
  const groups: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    groups.push(current);
    current = [];
  };
  for (const token of tokens) {
    const key = normalize(token);
    if (key.length < 2 || known.has(key)) {
      flush();
      continue;
    }
    current.push(token);
    if (current.length === MAX_GLOSS_WORDS) flush();
  }
  flush();
  return groups.map((group) => group.join(" "));
}

function shortWordGlosses(words: PhraseLine[] | undefined): PhraseLine[] {
  return (words ?? []).filter((word) => {
    const count = spokenWords(word.text).length;
    return word.text.trim().length > 0 && word.translation.trim().length > 0 && count > 0 && count <= MAX_GLOSS_WORDS;
  });
}

/** A register alternative is glossed as the new words, never as the whole sentence. */
function registerGloss(alternative: PhraseAlternative, core: string): { focus: string; focusTranslation: string; words?: PhraseLine[] } {
  const provided = shortWordGlosses(alternative.words);
  if (provided.length > 0) {
    const [first, ...rest] = provided;
    return {
      focus: first!.text.trim(),
      focusTranslation: first!.translation.trim(),
      ...(rest.length > 0 ? { words: rest } : {}),
    };
  }
  const phrases = novelFocuses(alternative.text, core);
  const [first, ...rest] = phrases.length > 0 ? phrases : [alternative.text.split(/\s+/u).slice(0, MAX_GLOSS_WORDS).join(" ")];
  const label = alternative.label.trim() || "a more formal way";
  return {
    focus: first!,
    focusTranslation: label,
    ...(rest.length > 0 ? { words: rest.map((text) => ({ text, translation: label })) } : {}),
  };
}

/** The words a gloss or same-word note actually teaches, ignoring a full-sentence translation. */
function taughtWords(segment: LessonSegment): string[] {
  const shown = lessonDisplayText(segment.text);
  const sameWord = shown.match(/^(.+?)\s+is the same word\b/i);
  const means = shown.match(/^(.+?)\s+means\s+["“]/i);
  const span = (sameWord?.[1] ?? means?.[1] ?? "").trim();
  if (!span) return [];
  const words = spokenWords(span);
  if (words.length === 0 || words.length > MAX_GLOSS_WORDS) return [];
  return words;
}

/** Every spoken token, including short pronouns and function words such as es, du, and zu. */
function spokenWords(text: string): string[] {
  return normalize(text).split(" ").filter((word) => word.length >= 2);
}

function sentenceParts(text: string): string[] {
  return text.split(/(?<=[.!?？。])\s+/u).map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Pair each target sentence with the native sentence in the same position. */
function pairedSentences(core: string, native: string): PhraseLine[] {
  const target = sentenceParts(core);
  const source = sentenceParts(native);
  if (target.length < 2 || source.length !== target.length) return [];
  return target.map((text, index) => ({ text, translation: source[index]! }));
}

/**
 * A situation has to keep the target phrase. For more than one sentence, reusing
 * the verb or main word of any one sentence is enough.
 */
function sharesCorePattern(answer: string, core: string): boolean {
  const parts = sentenceParts(core);
  return (parts.length > 1 ? parts : [core]).some((part) => sharesPart(answer, part));
}

function sharesPart(answer: string, part: string): boolean {
  const keys = spokenWords(part).filter((word) => word.length >= 4).flatMap((word) => {
    const stemmed = word.replace(/(en|st)$/u, "");
    return stemmed.length >= 3 && stemmed !== word ? [word, stemmed] : [word];
  });
  const words = spokenWords(answer);
  if (keys.length === 0) return words.some((word) => spokenWords(part).includes(word));
  return keys.some((key) => words.some((word) => word === key || (key.length >= 3 && word.startsWith(key))));
}

function formatCue(frame: string, translation: string, extra: { from?: string; to?: string } = {}): string {
  const meaning = meaningOf(translation);
  let template = frame;
  if (/^can\b/i.test(meaning)) {
    template = template.replaceAll("Can you say {translation}?", "Your turn: {translation}.");
    template = template.replaceAll("Can you say {translation}", "Your turn: {translation}");
  }
  let cue = template
    .replaceAll("{translation}", meaning)
    .replaceAll("{from}", extra.from ?? "")
    .replaceAll("{to}", extra.to ?? "");
  if (/[?？]\s*$/u.test(translation.trim()) && !/[?？]\s*$/u.test(cue)) {
    cue = cue.replace(/[.!]\s*$/u, "?");
  }
  return cue;
}

function produceCues(translation: string): string[] {
  return SPEAK_FRAMES.map((frame) => formatCue(frame, translation));
}

function swapCues(swap: PhraseSwap): string[] {
  return SWAP_FRAMES.map((frame) => {
    let template: string = frame;
    if (/^now$/i.test(swap.to) && /^Now, /u.test(template)) {
      template = template.replace(/^Now, /u, "");
      template = template.charAt(0).toUpperCase() + template.slice(1);
    }
    return formatCue(template, swap.translation, { from: swap.from, to: swap.to });
  });
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
  const known = new Set(spokenWords(core));
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const previous = segments[index - 1];
    if ((previous?.pauseAfterMs ?? 0) > 0 && segment?.language === language && segment.phase !== "warmup") {
      for (const word of spokenWords(segment.text)) {
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

function closingFor(meaning: string, situations: readonly PhraseSituation[]): string {
  const clerk = situations.find((item) => /\b(clerk|shop)\b/i.test(item.setup));
  const casual = situations.find((item) => /\bcasual\b/i.test(`${item.setup} ${item.usage ?? ""}`));
  const friend = situations.find((item) => /\bfriend\b/i.test(item.setup));
  const lines = ["Nice work."];
  if (clerk) lines.push(`With a clerk, use the line that means "${meaningOf(clerk.translation)}".`);
  if (casual) lines.push(`With a friend, the casual way is "${casual.answer}".`);
  else if (friend && friend !== clerk) lines.push(`With a friend, use the line that means "${meaningOf(friend.translation)}".`);
  lines.push(`The line you came in with means "${meaning}".`);
  return lines.join(" ");
}

/**
 * The prompt asks for at most two new glosses before the learner speaks.
 * A long phrase sometimes needs a third short gloss on its own cue, so the
 * lesson is rejected only when four or more new glosses pile up before one cue.
 */
function glossesStaySparse(segments: readonly LessonSegment[]): { ok: true } | { ok: false; detail: string } {
  const fresh: string[] = [];
  const reset = () => { fresh.length = 0; };
  for (const segment of segments) {
    if ((segment.pauseAfterMs ?? 0) > 0) {
      if (fresh.length > 3) {
        return { ok: false, detail: `${fresh.join(" | ")} → ${lessonDisplayText(segment.text)}` };
      }
      reset();
    }
    if (taughtWords(segment).length > 0) fresh.push(lessonDisplayText(segment.text));
  }
  if (fresh.length > 3) return { ok: false, detail: fresh.join(" | ") };
  return { ok: true };
}

export type PhraseShapeReason =
  | "missing_core"
  | "swaps_short"
  | "situations_short"
  | "roleplay_invalid"
  | "script_short"
  | "prompts_unclear"
  | "lines_not_distinct"
  | "focus_unglossed"
  | "answers_repeated"
  | "answer_words_unglossed"
  | "situation_off_pattern"
  | "glosses_bunched"
  | "pattern_repeated"
  | "title_short";

export type ShapedPhraseLesson = {
  title: string;
  topic: string;
  ruleId: string;
  summary: string;
  speakerNames: SpeakerNames;
  segments: LessonSegment[];
};

export type PhraseShapeResult =
  | { ok: true; lesson: ShapedPhraseLesson }
  | { ok: false; reason: PhraseShapeReason; detail?: string };

function reject(reason: PhraseShapeReason, detail?: string): PhraseShapeResult {
  const snippet = detail?.replace(/\s+/gu, " ").trim().slice(0, 180);
  return snippet ? { ok: false, reason, detail: snippet } : { ok: false, reason };
}

export function shapePhraseLesson(
  value: unknown,
  context: PhraseLessonContext,
): PhraseShapeResult {
  const core = context.translation.trim();
  const meaning = meaningOf(context.nativeText);
  if (core.length < 1 || meaning.length < 1 || context.phraseId.trim().length === 0 || context.phraseId.length > 40) return reject("missing_core");
  const source = asRecord(value) ?? {};
  const limits = budget(context.level);
  const note = textOf(context.note);
  const pattern = textOf(source.pattern).split(/(?<=[.!?])\s+/u)[0]?.trim() ?? "";
  const sentenceLines = pairedSentences(core, context.nativeText);
  const longLine = spokenWords(core).length > 8;
  const chunkLimit = sentenceLines.length > 1 || longLine
    ? Math.min(10, Math.max(limits.chunks, sentenceLines.length > 1 ? sentenceLines.length * 4 : 6))
    : limits.chunks;
  const chunks = context.level === "A1" || context.level === "A2" || sentenceLines.length > 1 || longLine
    ? readChunks(source.chunks, core).slice(0, chunkLimit)
    : [];
  const swaps = readSwaps(source.swaps, core).filter((swap) => !isLiteral(swap.answer, note)).slice(0, limits.swaps);
  if (swaps.length < limits.swaps) return reject("swaps_short");
  const read = readSituations(source.situations, core).filter((item) => !isLiteral(item.answer, note));
  const onPattern = read.filter((item) => sharesCorePattern(item.answer, core));
  if (onPattern.length < limits.situations) {
    const missed = read.filter((item) => !sharesCorePattern(item.answer, core)).map((item) => item.answer).join(" | ");
    return reject(read.length >= limits.situations ? "situation_off_pattern" : "situations_short", missed || `${onPattern.length} on pattern`);
  }
  const chosenSituations = onPattern.slice(0, limits.situations);
  for (const alternative of context.alternatives ?? []) {
    if (chosenSituations.some((item) => same(item.answer, alternative.text)) || same(alternative.text, core)) continue;
    if (isLiteral(alternative.text, note) || !sharesCorePattern(alternative.text, core)) continue;
    const glossed = registerGloss(alternative, core);
    const register = alternative.label.trim();
    const formalRegister = /formal/i.test(register);
    chosenSituations.push({
      setup: formalRegister ? "You want to sound a bit more formal." : `You want a more ${register || "casual"} way to say it.`,
      answer: alternative.text,
      translation: context.nativeText,
      focus: glossed.focus,
      focusTranslation: glossed.focusTranslation,
      usage: formalRegister ? "A more formal way to say it." : `This is the ${register || "other"} way to say it.`,
      ...(glossed.words && glossed.words.length > 0 ? { words: glossed.words } : {}),
    });
    break;
  }
  const roleRecord = asRecord(source.roleplay);
  const roleSetup = textOf(roleRecord?.setup) || chosenSituations[0]!.setup;
  const requestedRole = textOf(roleRecord?.answer);
  const roleSituation = chosenSituations.find((item) => same(item.answer, requestedRole)) ?? chosenSituations[0]!;
  if (isLiteral(roleSituation.answer, note) || same(roleSituation.answer, core)) return reject("roleplay_invalid");

  const drills: Drill[] = [
    {
      kind: "phrase",
      answer: core,
      translation: context.nativeText,
      cues: produceCues(context.nativeText),
      ...(context.transliteration ? { transliteration: context.transliteration } : {}),
    },
    ...swaps.map((swap) => ({
      kind: "swap" as const,
      answer: swap.answer,
      translation: swap.translation,
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
      translation: situation.translation,
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
      translation: roleSituation.translation,
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
      translation: drill.translation,
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
  push({ kind: "narration", phase: "hook", language: context.nativeLanguage, text: "Listen once, then we'll build it and try it in a few places.", delivery: "warm" });
  push({
    kind: "example",
    phase: "hook",
    language: context.targetLanguage,
    text: core,
    translation: context.nativeText,
    ...(context.transliteration ? { transliteration: context.transliteration } : {}),
    delivery: "clear",
  });
  push({ kind: "explanation", phase: "hook", language: context.nativeLanguage, text: gloss(core, meaning, context.targetLanguage), delivery: "clear" });
  if (note && !same(note, meaning) && !same(note, core)) {
    push({ kind: "explanation", phase: "note", language: context.nativeLanguage, text: note, delivery: "clear" });
    push({ kind: "explanation", phase: "note", language: context.nativeLanguage, text: "We'll practice the natural sentence, not the word-for-word version.", delivery: "clear" });
  }
  if (sentenceLines.length > 1) {
    push({ kind: "narration", phase: "chunk", language: context.nativeLanguage, text: "We'll learn one sentence at a time, then say both together.", delivery: "warm" });
    sentenceLines.forEach((sentence, index) => {
      const lead = index === 0 ? "The first sentence." : "The next sentence.";
      push({ kind: "narration", phase: "chunk", language: context.nativeLanguage, text: lead, delivery: "warm" });
      chunks
        .filter((chunk) => normalize(sentence.text).includes(normalize(chunk.text)) && !same(chunk.text, sentence.text))
        .forEach((chunk) => teach(chunk.text, chunk.translation, "chunk", true));
      ask({ answer: sentence.text, translation: sentence.translation, cues: produceCues(sentence.translation) }, "practice", index);
    });
    push({ kind: "narration", phase: "chunk", language: context.nativeLanguage, text: "Now both sentences together.", delivery: "warm" });
  } else if (chunks.length > 0) {
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
    { answer: core, translation: context.nativeText },
  ].filter((item): item is { answer: string; translation: string } => Boolean(item));
  quickItems.slice(0, 3).forEach((item, index) => {
    const frame = QUICK_FRAMES[index] ?? QUICK_FRAMES[0];
    ask({
      answer: item.answer,
      translation: item.translation,
      cues: [formatCue(frame, item.translation)],
    }, "quick", index);
  });

  push({ kind: "recap", phase: "summary", language: context.nativeLanguage, text: `The sentence you wanted is the one that means "${meaning}".`, delivery: "clear" });
  push({ kind: "recap", phase: "summary", language: context.targetLanguage, text: core, translation: meaning, delivery: "clear" });
  const swapLine = swaps[0];
  if (swapLine) {
    push({ kind: "recap", phase: "summary", language: context.nativeLanguage, text: `To change ${swapLine.from} to ${swapLine.to}, you say the new sentence like this.`, delivery: "clear" });
    push({ kind: "recap", phase: "summary", language: context.targetLanguage, text: swapLine.answer, translation: meaningOf(swapLine.translation), delivery: "clear" });
  }
  const clerk = chosenSituations.find((item) => /\b(clerk|shop)\b/i.test(item.setup));
  const formal = chosenSituations.find((item) => /\bformal\b/i.test(item.setup));
  const recapSituation = clerk ?? formal ?? roleSituation;
  const recapLine = clerk
    ? `With a clerk, the polite version means "${meaningOf(recapSituation.translation)}", and it sounds like this.`
    : formal
      ? `A more formal way to say it means "${meaningOf(recapSituation.translation)}", and it sounds like this.`
      : `Another way to say it means "${meaningOf(recapSituation.translation)}", and it sounds like this.`;
  push({ kind: "recap", phase: "summary", language: context.nativeLanguage, text: recapLine, delivery: "clear" });
  push({ kind: "recap", phase: "summary", language: context.targetLanguage, text: recapSituation.answer, translation: meaningOf(recapSituation.translation), delivery: "clear" });
  push({ kind: "recap", phase: "closing", language: context.nativeLanguage, text: closingFor(meaning, chosenSituations), delivery: "praise" });

  const focuses = [
    ...chunks.map((chunk) => chunk.text),
    ...swaps.map((swap) => swap.focus),
    ...chosenSituations.map((situation) => situation.focus),
  ];
  if (segments.length < 8 || segments.some((segment) => segment.speaker !== "teacher")) return reject("script_short");
  if (!phrasePromptsAreClear(segments)) return reject("prompts_unclear");
  if (!phraseLinesAreDistinct(segments)) return reject("lines_not_distinct");
  if (!focusesAreGlossedFirst(segments, focuses)) return reject("focus_unglossed");
  if (!phraseAnswersStayVaried(segments, context.targetLanguage)) return reject("answers_repeated");
  if (!answerWordsAreGlossed(segments, context.targetLanguage, core)) return reject("answer_words_unglossed");
  const sparse = glossesStaySparse(segments);
  if (!sparse.ok) return reject("glosses_bunched", sparse.detail);
  if (segments.filter((segment) => segment.phase === "pattern").length > 1) return reject("pattern_repeated");
  const title = clip(textOf(source.title) || `Saying: ${meaning}`, 90);
  const topic = clip(textOf(source.topic) || meaning, 160);
  const summary = clip(textOf(source.summary) || `Practice how to say "${meaning}" and a few variations.`, 280);
  if (title.length < 3 || topic.length < 3 || summary.length < 5) return reject("title_short");
  const voiced = applyTargetVoices(segments, context.nativeLanguage, context.targetLanguage);
  return {
    ok: true,
    lesson: {
      title,
      topic,
      ruleId: context.phraseId,
      summary,
      speakerNames: normalizeSpeakerNames({ teacher: teacherName }),
      segments: voiced.segments,
    },
  };
}
