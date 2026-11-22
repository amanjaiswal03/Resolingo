import type { LanguageId } from "./languages.js";
import type { LessonSegment } from "./schemas.js";
import type { SpeakerNames } from "./speakers.js";
import { isEmptyDrill, type PimsleurPhrase } from "./pimsleur.js";

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

export function reviewAsPhrase(item: ReviewItem): PimsleurPhrase {
  return {
    speaker: item.speaker,
    text: item.text,
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
    if (isEmptyDrill(segment.text, names)) continue;
    const key = normalize(segment.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    phrases.push({
      text: segment.text,
      translation: segment.translation,
      speaker: segment.speaker === "teacher" ? "speakerA" : segment.speaker,
    });
  }
  return phrases;
}
