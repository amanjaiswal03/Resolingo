import type { LanguageId } from "./languages.js";
import type { CefrLevel, LessonSegment } from "./schemas.js";
import { applyTargetVoices, lessonDisplayText, repairMarkup, visibleLessonText } from "./markup.js";
import { isClitic, needsWordSegment, segmentWords, splitSentences } from "./segment.js";
import { REVIEW_GAPS } from "./pimsleur.js";
import { speakingPauseMs } from "./speaking-timing.js";
import { normalizeSpeakerNames, type SpeakerNames } from "./speakers.js";
import {
  glossSubject,
  isGlossLine,
  languageName,
  line,
  smoothCue,
  withArticle,
  situationFlags,
  stripSpeakPrefix,
  template,
  type TeachingKey,
} from "./teaching.js";

/** Phrase lessons keep their earlier length. Conversation and grammar may use the full lesson cap. */
const MAX_PHRASE_SEGMENTS = 120;

/** Lookups kept on the profile. Older ones are deleted on the next save. */
export const MAX_STORED_PHRASES = 100;
export const PHRASE_LOOKUP_LIMIT = 30;
export const PHRASE_LOOKUP_UNLIMITED = 100;
/** The same target sentence is modeled and asked only a handful of times. */
export const MAX_IDENTICAL_PHRASE_ANSWERS = 5;

const SPEAK_KEYS = ["how", "can", "try", "give", "turn", "loud", "nowSay"] as const satisfies readonly TeachingKey[];

const SWAP_KEYS = ["swapInstead", "swapThis", "swapSame", "swapKeep"] as const satisfies readonly TeachingKey[];

const MAX_IDENTICAL_CUES = 2;
/** A gloss longer than this is a whole sentence, not a new word. */
const MAX_GLOSS_WORDS = 3;

const QUICK_KEYS = ["quick1", "quick2", "quick3"] as const satisfies readonly TeachingKey[];

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

/**
 * Spoken answers checked in Skills reviews each day. A session asks up to five
 * phrases with one retry each, so this covers many sessions. It is counted
 * apart from phrase lookups.
 */
export const SPEECH_CHECK_LIMIT = 150;
export const SPEECH_CHECK_UNLIMITED = 400;

export function speechCheckLimit(unlimitedLessons: unknown): number {
  return unlimitedLessons === true ? SPEECH_CHECK_UNLIMITED : SPEECH_CHECK_LIMIT;
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

/** Cache id for one learner query. The spoken "how would you say" frame does not create a second phrase. */
export function normalizePhraseQuery(text: string, language: LanguageId = "en-US"): string {
  return normalize(stripSpeakPrefix(text, language));
}

export function phraseIdFor(targetLanguage: string, level: string, query: string, language: LanguageId = "en-US"): string {
  return `phrase_${hashKey(`${targetLanguage}:${level}:${normalizePhraseQuery(query, language)}`)}`;
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

function gloss(text: string, translation: string, language: LanguageId, teaching: LanguageId): string {
  return line(teaching, "gloss", {
    target: `[[lang:${language}]]${meaningOf(text)}[[/lang]]`,
    meaning: meaningOf(translation),
  });
}

function contentWords(text: string): string[] {
  return segmentWords(text)
    .map((word) => word.normalize("NFC").toLocaleLowerCase("en-US"))
    .filter((word) => word.length >= 3 || needsWordSegment(word));
}

/** New content words in an alternative, grouped into short glosses of at most three words. */
function novelFocuses(answer: string, core: string, locale: LanguageId | string = "en-US"): string[] {
  const known = new Set(spokenWords(core, locale));
  const tokens = segmentWords(answer, locale);
  const groups: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    groups.push(current);
    current = [];
  };
  for (const token of tokens) {
    const key = token.normalize("NFC").toLocaleLowerCase(locale);
    if (isClitic(key, locale) || known.has(key) || (key.length < 2 && !needsWordSegment(key))) {
      flush();
      continue;
    }
    current.push(token);
    if (current.length === MAX_GLOSS_WORDS) flush();
  }
  flush();
  const joiner = /\s/u.test(answer) ? " " : "";
  return groups.map((group) => group.join(joiner));
}

function shortWordGlosses(words: PhraseLine[] | undefined): PhraseLine[] {
  return (words ?? []).filter((word) => {
    const count = spokenWords(word.text).length;
    return word.text.trim().length > 0 && word.translation.trim().length > 0 && count > 0 && count <= MAX_GLOSS_WORDS;
  });
}

/** A register alternative is glossed as the new words, never as the whole sentence. */
function registerGloss(alternative: PhraseAlternative, core: string, teaching: LanguageId): { focus: string; focusTranslation: string; words?: PhraseLine[] } {
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
  const fallback = segmentWords(alternative.text).slice(0, MAX_GLOSS_WORDS).join(/\s/u.test(alternative.text) ? " " : "");
  const [first, ...rest] = phrases.length > 0 ? phrases : [fallback];
  const label = alternative.label.trim() || line(teaching, "moreFormal");
  return {
    focus: first!,
    focusTranslation: label,
    ...(rest.length > 0 ? { words: rest.map((text) => ({ text, translation: label })) } : {}),
  };
}

/** The words a gloss or same-word note actually teaches, ignoring a full-sentence translation. */
function taughtWords(segment: LessonSegment, locale: LanguageId | string = "en-US"): string[] {
  const shown = lessonDisplayText(segment.text);
  const span = (glossSubject(shown, segment.language) ?? "").trim();
  if (!span) return [];
  const words = spokenWords(span, locale);
  if (words.length === 0 || words.length > MAX_GLOSS_WORDS) return [];
  return words;
}

/** Every spoken token, including short pronouns and function words such as es, du, and zu. */
function spokenWords(text: string, locale: LanguageId | string = "en-US"): string[] {
  return segmentWords(text, locale)
    .map((word) => word.normalize("NFC").toLocaleLowerCase(locale))
    .filter((word) => word.length >= 2 || needsWordSegment(word))
    .filter((word) => !isClitic(word, locale));
}

function sentenceParts(text: string): string[] {
  return splitSentences(text);
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
function sharesCorePattern(answer: string, core: string, locale: LanguageId | string = "en-US"): boolean {
  const parts = sentenceParts(core);
  return (parts.length > 1 ? parts : [core]).some((part) => sharesPart(answer, part, locale));
}

function sharesPart(answer: string, part: string, locale: LanguageId | string = "en-US"): boolean {
  const source = spokenWords(part, locale);
  const keys = source.filter((word) => word.length >= 4 || needsWordSegment(word)).flatMap((word) => {
    if (needsWordSegment(word)) return [word];
    const stemmed = word.replace(/(en|st)$/u, "");
    return stemmed.length >= 3 && stemmed !== word ? [word, stemmed] : [word];
  });
  const words = spokenWords(answer, locale);
  if (keys.length === 0) return words.some((word) => source.includes(word));
  return keys.some((key) => words.some((word) => word === key || (!needsWordSegment(key) && key.length >= 3 && word.startsWith(key))));
}

function formatCue(frame: string, translation: string, teaching: LanguageId, extra: { from?: string; to?: string } = {}): string {
  const meaning = meaningOf(translation);
  let cueTemplate = frame;
  const can = template(teaching, "canWord");
  if (new RegExp(`^${can.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu").test(meaning)) {
    cueTemplate = cueTemplate.replaceAll(template(teaching, "can"), template(teaching, "turn"));
  }
  let cue = cueTemplate
    .replaceAll("{translation}", meaning)
    .replaceAll("{from}", extra.from ?? "")
    .replaceAll("{to}", extra.to ?? "");
  if (/[?？]\s*$/u.test(translation.trim()) && !/[?？]\s*$/u.test(cue)) {
    cue = cue.replace(/[.!]\s*$/u, "?");
  }
  return smoothCue(cue, teaching);
}

function produceCues(translation: string, teaching: LanguageId): string[] {
  return SPEAK_KEYS.map((key) => formatCue(template(teaching, key), translation, teaching));
}

function swapCues(swap: PhraseSwap, teaching: LanguageId, nativeText: string): string[] {
  const now = template(teaching, "nowWord");
  const from = withArticle(swap.from, nativeText);
  const to = withArticle(swap.to, swap.translation);
  return SWAP_KEYS.map((key) => {
    const frame = key === "swapInstead" && swap.to.localeCompare(now, teaching, { sensitivity: "accent" }) === 0
      ? template(teaching, "swapBare")
      : template(teaching, key);
    return formatCue(frame, swap.translation, teaching, { from, to });
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
    const gloss = isGlossLine(previous, segments[index - 1]?.language ?? "en-US")
      || isGlossLine(current, segments[index]?.language ?? "en-US");
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
    if (needle.length < 2 && !needsWordSegment(needle)) continue;
    const glossAt = segments.findIndex((segment) => {
      const shown = lessonDisplayText(segment.text);
      return isGlossLine(shown, segment.language) && normalize(shown).includes(needle);
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
  const known = new Set(spokenWords(core, language));
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const previous = segments[index - 1];
    if ((previous?.pauseAfterMs ?? 0) > 0 && segment?.language === language && segment.phase !== "warmup") {
      for (const word of spokenWords(segment.text, language)) {
        if (!known.has(word)) return false;
      }
    }
    if (segment) {
      for (const word of taughtWords(segment, language)) known.add(word);
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

function introFor(context: PhraseLessonContext): string {
  const meaning = meaningOf(context.nativeText);
  const language = context.nativeLanguage;
  const named = languageName(language, context.targetLanguage);
  if (context.inputLanguage === "target") {
    return line(language, "already", { language: named, meaning });
  }
  if (context.inputLanguage === "mixed") {
    return line(language, "mixed", { language: named, meaning });
  }
  return line(language, "wanted", { meaning, language: named });
}

function closingFor(meaning: string, situations: readonly PhraseSituation[], teaching: LanguageId): string {
  const clerk = situations.find((item) => situationFlags(item.setup, teaching).clerk);
  const casual = situations.find((item) => situationFlags(`${item.setup} ${item.usage ?? ""}`, teaching).casual);
  const friend = situations.find((item) => situationFlags(item.setup, teaching).friend);
  const lines = [line(teaching, "nice")];
  if (clerk) lines.push(line(teaching, "clerkUse", { meaning: meaningOf(clerk.translation) }));
  if (casual) lines.push(line(teaching, "friendCasual", { answer: casual.answer }));
  else if (friend && friend !== clerk) lines.push(line(teaching, "friendUse", { meaning: meaningOf(friend.translation) }));
  lines.push(line(teaching, "cameWith", { meaning }));
  return lines.join(" ");
}

/**
 * The prompt asks for at most two new glosses before the learner speaks.
 * A long phrase sometimes needs a third short gloss on its own cue, so the
 * lesson is rejected only when four or more new glosses pile up before one cue.
 */
function glossesStaySparse(segments: readonly LessonSegment[], locale: LanguageId | string = "en-US"): { ok: true } | { ok: false; detail: string } {
  const fresh: string[] = [];
  const reset = () => { fresh.length = 0; };
  for (const segment of segments) {
    if ((segment.pauseAfterMs ?? 0) > 0) {
      if (fresh.length > 3) {
        return { ok: false, detail: `${fresh.join(" | ")} → ${lessonDisplayText(segment.text)}` };
      }
      reset();
    }
    if (taughtWords(segment, locale).length > 0) fresh.push(lessonDisplayText(segment.text));
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
  const pattern = splitSentences(textOf(source.pattern))[0]?.trim() ?? "";
  const sentenceLines = pairedSentences(core, context.nativeText);
  const longLine = spokenWords(core, context.targetLanguage).length > 8;
  const chunkLimit = sentenceLines.length > 1 || longLine
    ? Math.min(10, Math.max(limits.chunks, sentenceLines.length > 1 ? sentenceLines.length * 4 : 6))
    : limits.chunks;
  const chunks = context.level === "A1" || context.level === "A2" || sentenceLines.length > 1 || longLine
    ? readChunks(source.chunks, core).slice(0, chunkLimit)
    : [];
  const swaps = readSwaps(source.swaps, core).filter((swap) => !isLiteral(swap.answer, note)).slice(0, limits.swaps);
  if (swaps.length < limits.swaps) return reject("swaps_short");
  const read = readSituations(source.situations, core).filter((item) => !isLiteral(item.answer, note));
  const onPattern = read.filter((item) => sharesCorePattern(item.answer, core, context.targetLanguage));
  if (onPattern.length < limits.situations) {
    const missed = read.filter((item) => !sharesCorePattern(item.answer, core, context.targetLanguage)).map((item) => item.answer).join(" | ");
    return reject(read.length >= limits.situations ? "situation_off_pattern" : "situations_short", missed || `${onPattern.length} on pattern`);
  }
  const chosenSituations = onPattern.slice(0, limits.situations);
  for (const alternative of context.alternatives ?? []) {
    if (chosenSituations.some((item) => same(item.answer, alternative.text)) || same(alternative.text, core)) continue;
    if (isLiteral(alternative.text, note) || !sharesCorePattern(alternative.text, core, context.targetLanguage)) continue;
    const glossed = registerGloss(alternative, core, context.nativeLanguage);
    const register = alternative.label.trim();
    const formalRegister = template(context.nativeLanguage, "formalHint").split("|").some((word) => (
      word.length > 0 && new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(register)
    ));
    chosenSituations.push({
      setup: formalRegister
        ? line(context.nativeLanguage, "formalSetup")
        : line(context.nativeLanguage, "casualSetup", { register: register || template(context.nativeLanguage, "casualHint").split("|")[0] || "casual" }),
      answer: alternative.text,
      translation: context.nativeText,
      focus: glossed.focus,
      focusTranslation: glossed.focusTranslation,
      usage: formalRegister
        ? line(context.nativeLanguage, "formalUsage")
        : line(context.nativeLanguage, "otherUsage", { register: register || "other" }),
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
      cues: produceCues(context.nativeText, context.nativeLanguage),
      ...(context.transliteration ? { transliteration: context.transliteration } : {}),
    },
    ...swaps.map((swap) => ({
      kind: "swap" as const,
      answer: swap.answer,
      translation: swap.translation,
      cues: swapCues(swap, context.nativeLanguage, context.nativeText),
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
      cues: produceCues(situation.translation, context.nativeLanguage),
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
      cues: produceCues(roleSituation.translation, context.nativeLanguage),
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
    if (segments.length >= MAX_PHRASE_SEGMENTS) return false;
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
    if (!canSay(drill.answer) || segments.length + 2 > MAX_PHRASE_SEGMENTS - 8) return;
    if (phase === "review" && heard(drill.answer) >= 3) return;
    const cue = takeCue(drill.cues, used, salt);
    if (!cue) return;
    const answerPhase = phase === "practice" ? "answer" : phase;
    const before = segments.length;
    push({ kind: "drill", phase, language: context.nativeLanguage, text: cue, delivery: "curious" }, speakingPauseMs(drill.answer, context.targetLanguage));
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
      ? line(context.nativeLanguage, "sameWord", { word: meaningOf(word) })
      : gloss(word, translation, context.targetLanguage, context.nativeLanguage);
    push({ kind: "explanation", phase, language: context.nativeLanguage, text: note, delivery: "clear" });
    if (usage) push({ kind: "explanation", phase, language: context.nativeLanguage, text: usage, delivery: "clear" });
    if (!repeat || same(word, core)) return;
    ask({ answer: word, translation, cues: produceCues(translation, context.nativeLanguage) }, "focus", 1);
  };

  const teacherName = normalizeSpeakerNames(source.speakerNames).teacher;
  push({ kind: "narration", phase: "intro", language: context.nativeLanguage, text: introFor(context), delivery: "warm" });
  push({ kind: "narration", phase: "hook", language: context.nativeLanguage, text: line(context.nativeLanguage, "listenBuild"), delivery: "warm" });
  push({
    kind: "example",
    phase: "hook",
    language: context.targetLanguage,
    text: core,
    translation: context.nativeText,
    ...(context.transliteration ? { transliteration: context.transliteration } : {}),
    delivery: "clear",
  });
  push({ kind: "explanation", phase: "hook", language: context.nativeLanguage, text: gloss(core, meaning, context.targetLanguage, context.nativeLanguage), delivery: "clear" });
  if (note && !same(note, meaning) && !same(note, core)) {
    push({ kind: "explanation", phase: "note", language: context.nativeLanguage, text: note, delivery: "clear" });
    push({ kind: "explanation", phase: "note", language: context.nativeLanguage, text: line(context.nativeLanguage, "naturalSentence"), delivery: "clear" });
  }
  if (sentenceLines.length > 1) {
    push({ kind: "narration", phase: "chunk", language: context.nativeLanguage, text: line(context.nativeLanguage, "oneAtATime"), delivery: "warm" });
    sentenceLines.forEach((sentence, index) => {
      const lead = line(context.nativeLanguage, index === 0 ? "firstSentence" : "nextSentence");
      push({ kind: "narration", phase: "chunk", language: context.nativeLanguage, text: lead, delivery: "warm" });
      chunks
        .filter((chunk) => normalize(sentence.text).includes(normalize(chunk.text)) && !same(chunk.text, sentence.text))
        .forEach((chunk) => teach(chunk.text, chunk.translation, "chunk", true));
      ask({ answer: sentence.text, translation: sentence.translation, cues: produceCues(sentence.translation, context.nativeLanguage) }, "practice", index);
    });
    push({ kind: "narration", phase: "chunk", language: context.nativeLanguage, text: line(context.nativeLanguage, "bothTogether"), delivery: "warm" });
  } else if (chunks.length > 0) {
    push({ kind: "narration", phase: "chunk", language: context.nativeLanguage, text: line(context.nativeLanguage, "piecesFromEnd"), delivery: "warm" });
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
        push({ kind: "explanation", phase: drill.kind, language: context.nativeLanguage, text: gloss(drill.answer, drill.translation, context.targetLanguage, context.nativeLanguage), delivery: "clear" });
      }
      if (drill.usage) push({ kind: "explanation", phase: drill.kind, language: context.nativeLanguage, text: drill.usage, delivery: "clear" });
    } else if (drill.focus && drill.focusTranslation) {
      for (const word of drill.words ?? []) teach(word.text, word.translation, drill.kind, true);
      push({ kind: "example", phase: drill.kind, language: context.targetLanguage, text: drill.answer, translation: drill.translation, delivery: "clear" });
      const sentenceNote = same(drill.focus, drill.focusTranslation)
        ? line(context.nativeLanguage, "sameWord", { word: meaningOf(drill.focus) })
        : gloss(drill.focus, drill.focusTranslation, context.targetLanguage, context.nativeLanguage);
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
    chosenSituations.find((item) => situationFlags(item.setup, context.nativeLanguage).friend)
      ?? chosenSituations.find((item) => !same(item.answer, roleSituation.answer))
      ?? null,
    { answer: core, translation: context.nativeText },
  ].filter((item): item is { answer: string; translation: string } => Boolean(item));
  quickItems.slice(0, 3).forEach((item, index) => {
    const frame = template(context.nativeLanguage, QUICK_KEYS[index] ?? QUICK_KEYS[0]);
    ask({
      answer: item.answer,
      translation: item.translation,
      cues: [formatCue(frame, item.translation, context.nativeLanguage)],
    }, "quick", index);
  });

  push({ kind: "recap", phase: "summary", language: context.nativeLanguage, text: line(context.nativeLanguage, "wantedMeans", { meaning }), delivery: "clear" });
  push({ kind: "recap", phase: "summary", language: context.targetLanguage, text: core, translation: meaning, delivery: "clear" });
  const swapLine = swaps[0];
  if (swapLine) {
    push({
      kind: "recap",
      phase: "summary",
      language: context.nativeLanguage,
      text: smoothCue(line(context.nativeLanguage, "toChange", {
        from: withArticle(swapLine.from, context.nativeText),
        to: withArticle(swapLine.to, swapLine.translation),
      }), context.nativeLanguage),
      delivery: "clear",
    });
    push({ kind: "recap", phase: "summary", language: context.targetLanguage, text: swapLine.answer, translation: meaningOf(swapLine.translation), delivery: "clear" });
  }
  const clerk = chosenSituations.find((item) => situationFlags(item.setup, context.nativeLanguage).clerk);
  const formal = chosenSituations.find((item) => template(context.nativeLanguage, "formalHint").split("|").some((word) => (
    word.length > 0 && new RegExp(`(?:^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu").test(item.setup)
  )));
  const recapSituation = clerk ?? formal ?? roleSituation;
  const recapLine = clerk
    ? line(context.nativeLanguage, "clerkPolite", { meaning: meaningOf(recapSituation.translation) })
    : formal
      ? line(context.nativeLanguage, "formalMeans", { meaning: meaningOf(recapSituation.translation) })
      : line(context.nativeLanguage, "anotherMeans", { meaning: meaningOf(recapSituation.translation) });
  push({ kind: "recap", phase: "summary", language: context.nativeLanguage, text: recapLine, delivery: "clear" });
  push({ kind: "recap", phase: "summary", language: context.targetLanguage, text: recapSituation.answer, translation: meaningOf(recapSituation.translation), delivery: "clear" });
  push({ kind: "recap", phase: "closing", language: context.nativeLanguage, text: closingFor(meaning, chosenSituations, context.nativeLanguage), delivery: "praise" });

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
  const sparse = glossesStaySparse(segments, context.targetLanguage);
  if (!sparse.ok) return reject("glosses_bunched", sparse.detail);
  if (segments.filter((segment) => segment.phase === "pattern").length > 1) return reject("pattern_repeated");
  const title = clip(visibleLessonText(textOf(source.title)) || `Saying: ${meaning}`, 90);
  const topic = clip(visibleLessonText(textOf(source.topic)) || meaning, 160);
  const summary = clip(visibleLessonText(textOf(source.summary)) || `Practice how to say "${meaning}" and a few variations.`, 280);
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
