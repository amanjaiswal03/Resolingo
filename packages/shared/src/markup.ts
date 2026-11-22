import { languageIds, type LanguageId } from "./languages.js";
import { needsWordSegment, segmentWords } from "./segment.js";
import { stopwords } from "./teaching.js";

const TAG = /\[\[lang:([A-Za-z0-9-]+)\]\]|\[\[\/lang\]\]/g;

/**
 * Well-formed [[lang:xx-XX]] tags plus stray closers the model sometimes emits:
 * [/lang], [[/de]], [[de]], [ / lang ].
 */
const LANGUAGE_TAG = /\[{1,2}\s*\/\s*(?:lang\b(?::[A-Za-z0-9-]+)?|[a-z]{2,8}(?:-[A-Za-z0-9]+)?)\s*\]{1,2}|\[{1,2}\s*lang\b(?::[A-Za-z0-9-]+)?\s*\]{1,2}|\[{2}\s*[a-z]{2,3}(?:-[A-Za-z0-9]+)?\s*\]{2}/gi;

export type SpeechSpan = { language: LanguageId; text: string };

function isLanguageId(value: string): value is LanguageId {
  return (languageIds as readonly string[]).includes(value);
}

export function stripLanguageTags(text: string): string {
  return text.replace(LANGUAGE_TAG, "");
}

/** Transcript text with pronunciation tags removed, including stray closers. */
export function lessonDisplayText(text: string): string {
  return stripLanguageTags(text).replace(/[ \t]{2,}/g, " ").trim();
}

/** What the app stores and renders. Tags stay on the in-memory segment until audio is made. */
export function displayLessonSegment<T extends { text: string; translation?: string | undefined; transliteration?: string | undefined }>(segment: T): T {
  const text = lessonDisplayText(segment.text);
  const translation = segment.translation === undefined ? undefined : lessonDisplayText(segment.translation);
  const transliteration = segment.transliteration === undefined ? undefined : lessonDisplayText(segment.transliteration);
  return {
    ...segment,
    text: text || segment.text,
    ...(translation !== undefined ? { translation: translation || segment.translation } : {}),
    ...(transliteration !== undefined ? { transliteration: transliteration || segment.transliteration } : {}),
  };
}

/**
 * Split a line into the pieces a speech engine can pronounce with one language each.
 * The base language is the segment language. `[[lang:xx-XX]]...[[/lang]]` switches
 * only that span, whether the speaker is the tutor or a target-language character.
 */
export function speechSpans(text: string, base: LanguageId): SpeechSpan[] {
  const spans: SpeechSpan[] = [];
  let cursor = 0;
  let language = base;
  let open = false;
  for (const match of text.matchAll(TAG)) {
    const index = match.index ?? 0;
    pushSpan(spans, language, text.slice(cursor, index));
    const code = match[1];
    if (code) {
      if (!open && isLanguageId(code)) {
        language = code;
        open = true;
      } else {
        pushSpan(spans, language, match[0]);
      }
    } else {
      language = base;
      open = false;
    }
    cursor = index + match[0].length;
  }
  pushSpan(spans, language, text.slice(cursor));
  return foldPunctuation(spans
    .map((span) => ({ ...span, text: stripLanguageTags(span.text).replace(/[ \t]{2,}/g, " ") }))
    .filter((span) => span.text.trim().length > 0));
}

function foldPunctuation(spans: SpeechSpan[]): SpeechSpan[] {
  const folded: SpeechSpan[] = [];
  for (const span of spans) {
    const previous = folded[folded.length - 1];
    if (previous && /^[\s.,!?;:…。！？、]+$/u.test(span.text)) previous.text += span.text;
    else folded.push({ ...span });
  }
  return folded;
}

function foldToken(value: string, language: LanguageId): string {
  return value.normalize("NFC").toLocaleLowerCase(language);
}

function letterTokens(text: string): string[] {
  const normalized = text.normalize("NFC");
  if (needsWordSegment(normalized)) return segmentWords(normalized);
  return normalized.match(/\p{L}[\p{L}'’-]*|\p{N}+/gu) ?? [];
}

function distinctive(token: string, nativeWords: ReadonlySet<string>, nativeLanguage: LanguageId): boolean {
  const folded = foldToken(token, nativeLanguage);
  const stops = stopwords(nativeLanguage);
  const singleForeign = [...folded].length === 1 && (folded.codePointAt(0) ?? 0) > 0x7f;
  return (folded.length >= 2 || singleForeign) && !(stops?.has(folded)) && !nativeWords.has(folded);
}

function tagRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(/\[\[lang:[A-Za-z0-9-]+\]\][\s\S]*?\[\[\/lang\]\]/g)) {
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}

function overlaps(start: number, end: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

const EDGE_AFFIX = /^(?:[-‐][\p{L}\p{M}]+|[\p{L}\p{M}]+[-‐])$/u;

function phrasePattern(phrase: string): RegExp | null {
  const isAffix = EDGE_AFFIX.test(phrase);
  const words = isAffix ? [phrase] : letterTokens(phrase);
  if (words.length === 0) return null;
  const body = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s.,!?;:…]+");
  const boundary = isAffix ? "[\\p{L}\\p{M}\\p{N}\\p{Pd}]" : "[\\p{L}\\p{M}\\p{N}]";
  return new RegExp(`(?<!${boundary})${body}(?!${boundary})`, "giu");
}

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["\"", "\""],
  ["“", "”"],
  ["„", "“"],
  ["「", "」"],
  ["『", "』"],
  ["«", "»"],
];

function quoteInteriors(text: string): Array<{ start: number; end: number; interior: string }> {
  const found: Array<{ start: number; end: number; interior: string }> = [];
  let index = 0;
  while (index < text.length) {
    const opener = QUOTE_PAIRS.filter(([open]) => text.startsWith(open, index))
      .sort((left, right) => right[0].length - left[0].length)[0];
    if (!opener) {
      index += 1;
      continue;
    }
    const closeAt = text.indexOf(opener[1], index + opener[0].length);
    if (closeAt < 0) {
      index += opener[0].length;
      continue;
    }
    const start = index + opener[0].length;
    found.push({ start, end: closeAt, interior: text.slice(start, closeAt) });
    index = closeAt + opener[1].length;
  }
  return found;
}

/**
 * Wrap known target-language words inside a teaching-language line so speech
 * uses the target voice. Existing tags are left alone. A quoted run of those
 * words becomes one span, and words separated only by punctuation stay together.
 */
export function tagTargetLanguage(
  text: string,
  base: LanguageId,
  target: LanguageId,
  vocabulary: readonly string[],
  nativeWords: ReadonlySet<string>,
): string {
  if (base === target || !text.trim() || vocabulary.length === 0) return text;
  const occupied = tagRanges(text);
  const phrases = [...new Set(vocabulary.map((item) => item.trim()).filter((item) => (
    EDGE_AFFIX.test(item) || letterTokens(item).some((token) => distinctive(token, nativeWords, base))
  )))]
    .sort((left, right) => right.length - left.length);
  const matches: Array<{ start: number; end: number }> = [];
  for (const phrase of phrases) {
    const pattern = phrasePattern(phrase);
    if (!pattern) continue;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (overlaps(start, end, occupied) || overlaps(start, end, matches)) continue;
      matches.push({ start, end });
    }
  }
  for (const quote of quoteInteriors(text)) {
    const tokens = letterTokens(quote.interior);
    if (tokens.length === 0 || !tokens.every((token) => distinctive(token, nativeWords, base))) continue;
    if (overlaps(quote.start, quote.end, occupied)) continue;
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const item = matches[index]!;
      if (item.start >= quote.start && item.end <= quote.end) matches.splice(index, 1);
    }
    matches.push({ start: quote.start, end: quote.end });
  }
  matches.sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const match of matches) {
    const previous = merged[merged.length - 1];
    const gap = previous ? text.slice(previous.end, match.start) : "";
    if (previous && /^[\s.,!?;:…]+$/u.test(gap)) previous.end = match.end;
    else merged.push({ ...match });
  }
  let out = text;
  for (const range of merged.sort((left, right) => right.start - left.start)) {
    const slice = out.slice(range.start, range.end);
    if (!slice.trim()) continue;
    out = `${out.slice(0, range.start)}[[lang:${target}]]${slice}[[/lang]]${out.slice(range.end)}`;
  }
  return out;
}

type VoicedSegment = { language: LanguageId; text: string; translation?: string | undefined };

function vocabularyOf(segments: readonly VoicedSegment[], target: LanguageId, nativeLanguage: LanguageId): { phrases: string[]; nativeWords: Set<string> } {
  const phrases: string[] = [];
  const nativeWords = new Set<string>();
  for (const segment of segments) {
    if (segment.translation) {
      for (const token of letterTokens(lessonDisplayText(segment.translation))) nativeWords.add(foldToken(token, nativeLanguage));
    }
    const shown = lessonDisplayText(segment.text);
    if (segment.language === target) phrases.push(shown);
    else {
      for (const match of shown.matchAll(/\b(\p{L}{3,}),\s+to\b/giu)) phrases.push(match[1] ?? "");
    }
    for (const match of segment.text.matchAll(/\[\[lang:([A-Za-z0-9-]+)\]\]([\s\S]*?)\[\[\/lang\]\]/g)) {
      if (match[1] === target && match[2]?.trim()) phrases.push(lessonDisplayText(match[2]));
    }
  }
  const tokens = phrases.flatMap((phrase) => letterTokens(phrase));
  return { phrases: [...phrases, ...tokens], nativeWords };
}

/** Target words still sitting in a teaching-language span, after tagging. */
export function untaggedTargetTokens(
  text: string,
  base: LanguageId,
  target: LanguageId,
  vocabulary: readonly string[],
  nativeWords: ReadonlySet<string>,
): string[] {
  if (base === target) return [];
  const known = new Set(vocabulary.flatMap((phrase) => letterTokens(phrase).map((token) => foldToken(token, target))));
  const found: string[] = [];
  for (const span of speechSpans(text, base)) {
    if (span.language !== base) continue;
    for (const token of letterTokens(span.text)) {
      if (!known.has(foldToken(token, target)) || !distinctive(token, nativeWords, base)) continue;
      found.push(token);
    }
  }
  return found;
}

/**
 * Put every known target word in a native-language segment into its own
 * target-language span. Returns any word that is still spoken in the native span.
 */
export function applyTargetVoices<T extends VoicedSegment>(
  segments: readonly T[],
  nativeLanguage: LanguageId,
  targetLanguage: LanguageId,
  additionalTerms: readonly string[] = [],
): { segments: T[]; leftover: string[] } {
  const { phrases, nativeWords } = vocabularyOf(segments, targetLanguage, nativeLanguage);
  const vocabulary = [...phrases, ...additionalTerms];
  const leftover: string[] = [];
  const next = segments.map((segment) => {
    if (segment.language !== nativeLanguage) return segment;
    const text = tagTargetLanguage(segment.text, nativeLanguage, targetLanguage, vocabulary, nativeWords);
    const missed = untaggedTargetTokens(text, nativeLanguage, targetLanguage, vocabulary, nativeWords);
    for (const token of missed) leftover.push(token);
    return text === segment.text ? segment : { ...segment, text };
  });
  return { segments: next, leftover: [...new Set(leftover)].slice(0, 8) };
}

function pushSpan(spans: SpeechSpan[], language: LanguageId, text: string): void {
  if (!text) return;
  const previous = spans[spans.length - 1];
  if (previous && previous.language === language) previous.text += text;
  else spans.push({ language, text });
}

/**
 * Close or drop tags the model left unfinished, then keep a line the speech
 * engine can split. A still-broken result falls back to the words with the tags removed.
 */
export function repairMarkup(text: string): string {
  if (markupIssues(text).length === 0) return text;
  let out = "";
  let cursor = 0;
  let open: string | null = null;
  let openAt = 0;
  for (const match of text.matchAll(TAG)) {
    const index = match.index ?? 0;
    out += text.slice(cursor, index);
    const code = match[1];
    if (code) {
      if (open) {
        if (out.slice(openAt) === `[[lang:${open}]]`) out = out.slice(0, openAt);
        else out += "[[/lang]]";
        open = null;
      }
      if (isLanguageId(code)) {
        openAt = out.length;
        out += match[0];
        open = code;
      }
    } else if (open) {
      if (out.slice(openAt) === `[[lang:${open}]]`) out = out.slice(0, openAt);
      else out += "[[/lang]]";
      open = null;
    }
    cursor = index + match[0].length;
  }
  out += text.slice(cursor);
  if (open) {
    if (out.slice(openAt) === `[[lang:${open}]]`) out = out.slice(0, openAt);
    else out += "[[/lang]]";
  }
  const cleaned = out.replace(/[ \t]{2,}/g, " ").trim();
  if (cleaned && markupIssues(cleaned).length === 0) return cleaned;
  const plain = lessonDisplayText(text);
  return plain || text;
}

/** Why a generated line cannot be spoken span by span. Empty means the markup is usable. */
export function markupIssues(text: string): string[] {
  const issues: string[] = [];
  let open: string | null = null;
  let innerStart = 0;
  for (const match of text.matchAll(TAG)) {
    const code = match[1];
    if (code) {
      if (open) issues.push("nested");
      if (!isLanguageId(code)) issues.push(`unknown:${code}`);
      else open = code;
      innerStart = (match.index ?? 0) + match[0].length;
    } else if (!open) {
      issues.push("unexpected-close");
    } else {
      if (!text.slice(innerStart, match.index).trim()) issues.push("empty");
      open = null;
    }
  }
  if (open) issues.push("unclosed");
  return issues;
}
