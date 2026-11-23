import type { LanguageId } from "./languages.js";

const SPAN = /\[\[lang:([^\]]+)\]\]([\s\S]*?)\[\[\/lang\]\]/gu;

function plain(value: string): string {
  return value.replace(/\[\[\/?lang(?::[^\]]+)?\]\]/gu, "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

/** The target-language words a teaching line quotes inside [[lang:…]] tags. */
export function quotedTarget(note: string, language: LanguageId): string[] {
  return [...note.matchAll(SPAN)].filter((match) => match[1] === language).map((match) => match[2] ?? "").filter((text) => plain(text));
}

/**
 * A note that refers back to earlier material may only quote words that are
 * really there. Every quoted target-language span has to appear, word for
 * word, in one of the source lines. A note with no quote passes.
 */
export function quotesStayTrue(note: string, sources: readonly string[], language: LanguageId): boolean {
  // Scripts written without spaces between words match on characters instead.
  const unspaced = /^(ja|zh|th|lo|km|my)\b/u.test(language);
  const shape = (value: string) => (unspaced ? plain(value).replace(/\s+/gu, "") : ` ${plain(value)} `);
  const pool = sources.map(shape);
  return quotedTarget(note, language).every((quote) => {
    const words = shape(quote);
    return pool.some((source) => source.includes(words));
  });
}
