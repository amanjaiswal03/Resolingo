import { languageIds, type LanguageId } from "./languages.js";

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
