import type { LanguageId } from "./languages.js";
import type { LessonSegment } from "./schemas.js";
import { LOCALES } from "./teaching-locales.js";
import { template } from "./teaching.js";

/**
 * A line the learner is asked to say is only the target-language words.
 * Generated content sometimes hands back a gloss instead, such as
 * "'Das Kind' means 'The Child'" or "Das Kind (the child)", and that whole
 * sentence then becomes the answer of a recall drill. These helpers cut such a
 * line back to the target words.
 */

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["\"", "\""], ["'", "'"], ["“", "”"], ["„", "“"], ["‘", "’"], ["‚", "‘"],
  ["«", "»"], ["»", "«"], ["「", "」"], ["『", "』"], ["《", "》"], ["`", "`"],
];
const QUOTES = new Set(QUOTE_PAIRS.flat());
const END_PUNCTUATION = /[.!?？。！]+$/u;

/** Phrases that join a target line to its meaning, by the language they are written in. */
const EXTRA_CONNECTORS: Record<string, readonly string[]> = {
  en: ["means", "which means", "meaning", "is how you say", "is how to say", "translates to", "translates as", "stands for"],
  de: ["bedeutet", "heißt auf Deutsch", "heißt übersetzt"],
  es: ["significa", "quiere decir"],
  fr: ["signifie", "veut dire"],
  it: ["significa", "vuol dire"],
  pt: ["significa", "quer dizer"],
  nl: ["betekent"],
};

type Connector = { phrase: string; language: string; pattern: RegExp };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function baseOf(language: string): string {
  return language.split("-")[0]!.toLocaleLowerCase();
}

let connectorCache: Connector[] | null = null;

/** Every teaching table's own gloss wording ("{target} means …") plus a few common English ones. */
function connectors(): Connector[] {
  if (connectorCache) return connectorCache;
  const found = new Map<string, Connector>();
  const add = (phrase: string, language: string) => {
    const words = phrase.replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
    // A single particle such as Japanese は is too common to read as a gloss.
    if (Array.from(words.replace(/\s/gu, "")).length < 3) return;
    const key = `${language}:${words.toLocaleLowerCase()}`;
    if (found.has(key)) return;
    const spaced = /\s/u.test(words) || /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u.test(words);
    const body = words.split(" ").map(escapeRegExp).join("\\s+");
    const pattern = spaced
      ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu")
      : new RegExp(body, "u");
    found.set(key, { phrase: words, language, pattern });
  };
  const languages = ["en-US", ...Object.keys(LOCALES)] as LanguageId[];
  for (const language of languages) {
    const raw = template(language, "gloss");
    const start = raw.indexOf("{target}");
    const end = raw.indexOf("{meaning}");
    if (start >= 0 && end > start) add(raw.slice(start + "{target}".length, end), baseOf(language));
  }
  for (const [language, phrases] of Object.entries(EXTRA_CONNECTORS)) {
    for (const phrase of phrases) add(phrase, language);
  }
  connectorCache = [...found.values()].sort((left, right) => right.phrase.length - left.phrase.length);
  return connectorCache;
}

/** Connector phrases that are ordinary words in this language, such as Spanish and Italian significa. */
function connectorsIn(language: string): Set<string> {
  return new Set(connectors().filter((connector) => connector.language === language).map((connector) => connector.phrase.toLocaleLowerCase()));
}

function plain(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function quoted(value: string): boolean {
  const text = value.trim().replace(END_PUNCTUATION, "").trim();
  const chars = Array.from(text);
  if (chars.length < 3) return false;
  return QUOTES.has(chars[0]!) && QUOTES.has(chars[chars.length - 1]!);
}

/** Drop one pair of quotes around the whole text, keeping a final mark that sat outside them. */
function unquote(value: string): string {
  let text = value.trim();
  const tail = text.match(END_PUNCTUATION)?.[0] ?? "";
  const body = tail ? text.slice(0, -tail.length).trim() : text;
  for (const [open, close] of QUOTE_PAIRS) {
    if (body.length > open.length + close.length && body.startsWith(open) && body.endsWith(close)) {
      const inner = body.slice(open.length, body.length - close.length).trim();
      // "a" and "b" is two quotations, not one quoted line.
      if (inner.includes(open) || inner.includes(close)) return text;
      text = `${inner}${tail && !END_PUNCTUATION.test(inner) ? tail : ""}`;
      return text.trim();
    }
  }
  return text;
}

function sameMeaning(candidate: string, translation: string | undefined): boolean {
  if (!translation) return false;
  const left = plain(unquote(candidate));
  const right = plain(translation);
  if (!left || !right) return false;
  return left === right || (right.length >= 3 && left.includes(right)) || (left.length >= 3 && right.includes(left));
}

export type AnswerTextOptions = {
  /** The line's meaning in the teaching language. A trailing copy of it is a gloss. */
  translation?: string;
  /** The language the line should be in. A connector from another language marks a gloss. */
  language?: LanguageId | string;
};

/**
 * Only the target-language words of a line the learner says.
 * "'Das Kind' means 'The Child'" becomes "Das Kind", and "Das Kind (the child)"
 * becomes "Das Kind". A plain line comes back unchanged.
 */
export function targetAnswerText(text: string, options: AnswerTextOptions = {}): string {
  const original = text.trim();
  if (!original) return original;
  const target = options.language ? baseOf(options.language) : undefined;
  let out = original;

  // A target span tagged inside a teaching sentence: keep the tagged words.
  const spans = [...original.matchAll(/\[\[lang:[^\]]+\]\]([\s\S]*?)\[\[\/lang\]\]/gu)];
  if (spans.length === 1) {
    const outside = plain(original.replace(spans[0]![0], " "));
    if (outside && connectors().some((connector) => connector.pattern.test(outside))) {
      out = spans[0]![1]!.trim();
    }
  }

  // "X means Y", "'X' bedeutet „Y“", "X is how you say Y".
  for (const connector of connectors()) {
    const match = connector.pattern.exec(out);
    if (!match || match.index === undefined || match.index === 0) continue;
    const left = out.slice(0, match.index).trim().replace(/[,:;—–-]+$/u, "").trim();
    const right = out.slice(match.index + match[0].length).trim();
    if (!plain(left) || !plain(right)) continue;
    const foreign = target !== undefined && !connectorsIn(target).has(connector.phrase.toLocaleLowerCase());
    if (quoted(left) || quoted(right) || sameMeaning(right, options.translation) || foreign) {
      out = left;
      break;
    }
  }

  // "Das Kind (the child)", "Das Kind — the child", "Das Kind: the child", "Das Kind = the child".
  const trailing = out.match(/^(.+?)\s*(?:\(([^()]+)\)|\[([^[\]]+)\]|\s[—–-]\s+(.+)|:\s+(.+)|\s=\s*(.+)|\s→\s*(.+))\s*[.!?。]?$/u);
  if (trailing) {
    const tail = trailing.slice(2).find((part) => part !== undefined) ?? "";
    if (plain(trailing[1]!) && sameMeaning(tail, options.translation)) out = trailing[1]!.trim();
  }

  // A line wrapped in quotes as if it were cited.
  out = unquote(out);
  if (quoted(out)) out = unquote(out);
  return plain(out) ? out : original;
}

/** True when the line still carries a gloss or its own translation. */
export function isGlossedAnswer(text: string, options: AnswerTextOptions = {}): boolean {
  return plain(targetAnswerText(text, options)) !== plain(text);
}

const ANSWER_KINDS = new Set<LessonSegment["kind"]>(["drill", "example", "dialogue", "recap"]);

/**
 * Every target-language line in a lesson, cut back to the target words.
 * A last guard after the builders, so a gloss never becomes a spoken model answer.
 */
export function tidyTargetAnswers<T extends Pick<LessonSegment, "kind" | "language" | "text"> & { translation?: string | undefined }>(
  segments: readonly T[],
  targetLanguage: LanguageId,
): T[] {
  return segments.map((segment) => {
    if (segment.language !== targetLanguage || !ANSWER_KINDS.has(segment.kind)) return segment;
    const text = targetAnswerText(segment.text, {
      language: targetLanguage,
      ...(segment.translation ? { translation: segment.translation } : {}),
    });
    return text === segment.text.trim() || text === segment.text ? segment : { ...segment, text };
  });
}
