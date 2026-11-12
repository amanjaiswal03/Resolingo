import { languageIds, type LanguageId } from "./languages.js";

const TAG = /\[\[lang:([A-Za-z0-9-]+)\]\]|\[\[\/lang\]\]/g;

export type SpeechSpan = { language: LanguageId; text: string };

function isLanguageId(value: string): value is LanguageId {
  return (languageIds as readonly string[]).includes(value);
}

/** Transcript text with pronunciation tags removed. */
export function lessonDisplayText(text: string): string {
  return text
    .replace(/\[\[lang:[^\]]+\]\]/g, "")
    .replace(/\[\[\/lang\]\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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
  return foldPunctuation(spans.filter((span) => span.text.trim().length > 0));
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
