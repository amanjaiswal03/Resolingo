import type { LanguageId } from "./languages.js";
import { quotedTarget } from "./quotes.js";
import type { LessonSegment } from "./schemas.js";
import { segmentWords } from "./segment.js";

/**
 * Guards that keep a generated lesson on its own script. A teaching line may
 * only quote target-language words the lesson really teaches, and a buildup
 * piece must be a run of words from its own line. Anything else is a word,
 * phrase, or sentence the model made up, and the learner would hear it out of
 * nowhere.
 */

const UNSPACED = /^(ja|zh|th|lo|km|my)\b/u;

function stripTags(value: string): string {
  return value.replace(/\[\[\/?lang(?::[^\]]+)?\]\]/gu, "");
}

function wordsOf(text: string, language: LanguageId): string[] {
  return segmentWords(stripTags(text).replace(/[-‐]/gu, " "), language)
    .map((word) => word.normalize("NFC").toLocaleLowerCase(language));
}

function compact(text: string, language: LanguageId): string {
  return wordsOf(text, language).join("");
}

export type TargetVocabulary = { language: LanguageId; words: Set<string>; joined: string };

/** Every target-language word the lesson's own material uses. */
export function targetVocabulary(texts: readonly string[], language: LanguageId): TargetVocabulary {
  const words = new Set(texts.flatMap((text) => wordsOf(text, language)));
  return { language, words, joined: texts.map((text) => compact(text, language)).join("\n") };
}

function sharedPrefix(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

/**
 * A quoted word is on script when the lesson uses it, or a form of it: an
 * ending or short particle found inside a lesson word ("-st", "du"), the same
 * stem ("kannst" for "kann"), or a compound or infinitive built on a lesson
 * word ("zurückbringen" for "zurück"). A word with nothing in common with the
 * lesson fails.
 */
export function wordOnScript(word: string, vocabulary: TargetVocabulary): boolean {
  const value = word.toLocaleLowerCase(vocabulary.language);
  if (!value) return true;
  if (UNSPACED.test(vocabulary.language)) return vocabulary.joined.includes(value);
  if (vocabulary.words.has(value)) return true;
  const length = Array.from(value).length;
  for (const known of vocabulary.words) {
    const knownLength = Array.from(known).length;
    if (length <= 3 && known.includes(value)) return true;
    if (knownLength >= 4 && value.includes(known)) return true;
    if (length >= 4 && known.includes(value)) return true;
    if (sharedPrefix(value, known) >= Math.max(4, Math.ceil(Math.min(length, knownLength) * 0.6))) return true;
  }
  // Articles, pronouns, and particles of three letters or fewer are not a made-up phrase on their own.
  return length <= 3;
}

/** The quoted target-language words in a teaching line that the lesson never uses. */
export function offScriptWords(note: string, vocabulary: TargetVocabulary): string[] {
  return quotedTarget(note, vocabulary.language)
    .flatMap((quote) => wordsOf(quote, vocabulary.language))
    .filter((word) => !wordOnScript(word, vocabulary));
}

export function quotesOnScript(note: string, vocabulary: TargetVocabulary): boolean {
  return offScriptWords(note, vocabulary).length === 0;
}

/** A buildup piece is a run of consecutive words taken from its own line. */
export function pieceOfLine(piece: string, lineText: string, language: LanguageId): boolean {
  if (UNSPACED.test(language)) {
    const part = compact(piece, language);
    return part.length > 0 && compact(lineText, language).includes(part);
  }
  const part = wordsOf(piece, language);
  const whole = wordsOf(lineText, language);
  if (part.length === 0 || part.length > whole.length) return false;
  for (let start = 0; start + part.length <= whole.length; start += 1) {
    if (part.every((word, offset) => whole[start + offset] === word)) return true;
  }
  return false;
}

export type OffScriptLine = { id: string; kind: LessonSegment["kind"]; words: string[] };

/**
 * Teaching-language lines that quote target words found nowhere in the
 * lesson's target-language lines. The final check before a lesson is saved.
 */
export function offScriptLines(
  segments: readonly LessonSegment[],
  targetLanguage: LanguageId,
  /** Other material the lesson is built on, such as the grammar topic's forms or the learner's own phrase. */
  sources: readonly string[] = [],
): OffScriptLine[] {
  const vocabulary = targetVocabulary([
    ...segments.filter((segment) => segment.language === targetLanguage).map((segment) => segment.text),
    ...sources,
  ], targetLanguage);
  return segments.flatMap((segment) => {
    if (segment.language === targetLanguage) return [];
    const words = offScriptWords(segment.text, vocabulary);
    return words.length > 0 ? [{ id: segment.id, kind: segment.kind, words }] : [];
  });
}

const DROPPABLE = new Set<LessonSegment["kind"]>(["explanation", "narration", "recap"]);

/**
 * The lesson without its off-script teaching lines. Only a note can go: a
 * drill prompt that quotes made-up words cannot be dropped without leaving
 * its answer behind, so that lesson is rejected (null).
 */
export function withoutOffScriptLines(segments: readonly LessonSegment[], issues: readonly OffScriptLine[]): LessonSegment[] | null {
  if (issues.length === 0) return [...segments];
  if (issues.some((issue) => !DROPPABLE.has(issue.kind))) return null;
  const drop = new Set(issues.map((issue) => issue.id));
  return segments.filter((segment) => !drop.has(segment.id));
}
