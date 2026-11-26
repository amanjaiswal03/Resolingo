import type { LanguageId } from "./languages.js";
import type { LessonSegment } from "./schemas.js";
import type { SpeakerNames } from "./speakers.js";
import { isEmptyDrill, type PimsleurPhrase } from "./pimsleur.js";
import { targetAnswerText } from "./answer-text.js";

/** A phrase the learner has produced, kept so a later lesson can ask for it again. */
export type ReviewItem = {
  id: string;
  text: string;
  translation: string;
  language: LanguageId;
  nativeLanguage: LanguageId;
  speaker: "speakerA" | "speakerB";
  /** Catalog id of the grammar point, when the phrase was learned in a grammar lesson. */
  ruleId?: string;
  /** How many lessons have asked for this phrase. */
  strength: number;
  /** Days until the next review. Doubles after each successful lesson, up to a month. */
  intervalDays: number;
  lastSeen: string;
  dueAt: string;
};

const DAY_MS = 86_400_000;
export const MAX_REVIEW_INTERVAL_DAYS = 32;
/** Warm-up at the start of the next lesson, then one more mixed in. */
export const MAX_CARRIED_REVIEWS = 3;
export const MAX_WARMUP_REVIEWS = 2;

const REMEMBERED_PHASES = new Set(["answer", "review", "warmup", "recombine", "roleplay", "hook", "example"]);
const REMEMBERED_SPEAKERS = new Set(["speakerA", "speakerB", "teacher"]);

/** Punctuation becomes a space. CJK characters stay together, so an id does not depend on inserted spaces. */
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

export function reviewItemId(language: string, text: string): string {
  return `item_${hashKey(`${language}:${normalize(text)}`)}`;
}

export function touchReview(
  existing: ReviewItem | undefined,
  seen: { text: string; translation: string; language: LanguageId; nativeLanguage: LanguageId; speaker: "speakerA" | "speakerB"; ruleId?: string },
  seenAt: number,
): ReviewItem {
  const intervalDays = existing
    ? Math.min(MAX_REVIEW_INTERVAL_DAYS, Math.max(1, existing.intervalDays) * 2)
    : 1;
  const ruleId = seen.ruleId || existing?.ruleId;
  return {
    id: reviewItemId(seen.language, seen.text),
    text: seen.text,
    translation: seen.translation || existing?.translation || "",
    language: seen.language,
    nativeLanguage: seen.nativeLanguage,
    speaker: seen.speaker,
    ...(ruleId ? { ruleId } : {}),
    strength: (existing?.strength ?? 0) + 1,
    intervalDays,
    lastSeen: new Date(seenAt).toISOString(),
    dueAt: new Date(seenAt + intervalDays * DAY_MS).toISOString(),
  };
}

/** Most overdue first, then the least practiced. Other languages and future items stay out. */
export function selectDueReviews(
  items: readonly ReviewItem[],
  now: number,
  language: LanguageId,
  nativeLanguage: LanguageId,
  limit: number,
): ReviewItem[] {
  return items
    .filter((item) => item.language === language && item.nativeLanguage === nativeLanguage)
    .filter((item) => item.text.trim() && item.translation.trim())
    .filter((item) => Date.parse(item.dueAt) <= now)
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt) || left.strength - right.strength)
    .slice(0, Math.max(0, limit));
}

/** A stored item asked again later. A gloss saved by an older lesson is cut back to the target words. */
export function reviewAsPhrase(item: ReviewItem): PimsleurPhrase {
  return {
    speaker: item.speaker,
    text: targetAnswerText(item.text, { translation: item.translation, language: item.language }),
    translation: item.translation,
    language: item.language,
  };
}

/** Full phrases the learner actually produced. Dialogue playback alone does not count. */
export function phrasesToRemember(
  segments: readonly LessonSegment[],
  names: SpeakerNames,
  language: LanguageId,
): Array<{ text: string; translation: string; speaker: "speakerA" | "speakerB" }> {
  const seen = new Set<string>();
  const phrases: Array<{ text: string; translation: string; speaker: "speakerA" | "speakerB" }> = [];
  for (const segment of segments) {
    if (!REMEMBERED_SPEAKERS.has(segment.speaker)) continue;
    if (!segment.phase || !REMEMBERED_PHASES.has(segment.phase)) continue;
    if (segment.language !== language || !segment.translation?.trim()) continue;
    const text = targetAnswerText(segment.text, { translation: segment.translation, language });
    if (isEmptyDrill(text, names)) continue;
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    phrases.push({
      text,
      translation: segment.translation,
      speaker: segment.speaker === "teacher" ? "speakerA" : segment.speaker,
    });
  }
  return phrases;
}

/** A phrase the learner has already practised in a finished lesson. */
export type KnownPhrase = { text: string; translation?: string };

function knownTokens(text: string, language: string): string[] {
  const plain = normalize(text.replace(/\[\[\/?lang(?::[^\]]+)?\]\]/gu, ""));
  if (!plain) return [];
  // Unspaced scripts compare by character pairs, so a word boundary is not needed.
  if (!/\s/u.test(plain) && Array.from(plain).length > 3 && /^(ja|zh|th)/u.test(language)) {
    const chars = Array.from(plain);
    return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
  }
  return plain.split(" ");
}

/**
 * How close a new line is to one the learner already knows, from 0 to 1.
 * Word overlap over the larger of the two lines, so a short known phrase
 * does not swallow a longer new sentence that merely contains it.
 */
export function phraseSimilarity(left: string, right: string, language: string): number {
  const a = knownTokens(left, language);
  const b = knownTokens(right, language);
  if (a.length === 0 || b.length === 0) return 0;
  if (a.join(" ") === b.join(" ")) return 1;
  const remaining = [...b];
  let shared = 0;
  for (const token of a) {
    const at = remaining.indexOf(token);
    if (at >= 0) {
      shared += 1;
      remaining.splice(at, 1);
    }
  }
  return shared / Math.max(a.length, b.length);
}

/**
 * Close enough to count as known without the model's judgment: the same words
 * in any order, or one small word added or dropped in a long line. A line that
 * swaps a content word, such as a new noun, still teaches something, so the
 * model decides that case with its known mark.
 */
export const KNOWN_SIMILARITY = 0.85;
const KNOWN_MIN_WORDS = 6;

/** The known phrase this line repeats, or a close variant of it. */
export function findKnownPhrase(text: string, known: readonly KnownPhrase[], language: string): KnownPhrase | undefined {
  let best: { phrase: KnownPhrase; score: number } | undefined;
  for (const phrase of known) {
    const score = phraseSimilarity(text, phrase.text, language);
    const words = Math.max(knownTokens(text, language).length, knownTokens(phrase.text, language).length);
    const close = score === 1 || (words >= KNOWN_MIN_WORDS && score >= KNOWN_SIMILARITY);
    if (close && (!best || score > best.score)) best = { phrase, score };
  }
  return best?.phrase;
}
