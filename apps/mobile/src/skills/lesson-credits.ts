import type { Lesson } from "@resolingo/shared";
import type { AnswerPlan } from "../lesson/answer-windows";
import { phraseMatch, type VoiceResult } from "../lesson/phrase-match";
import { lessonLanguagePair, makeCard } from "./model";

export type LessonCredit = { card: { id: string; previousIds?: string[] }; matched: boolean };

/**
 * Turn checked answers into Skills progress, once per lesson sitting. A
 * phrase counts as said right if any of its checks matched, and as missed
 * only if a check heard the learner and none matched. Close answers and
 * skips leave the phrase as it is. Buildup pieces are not phrases.
 */
export function lessonCredits(lesson: Lesson, plan: AnswerPlan | null, results: Record<string, VoiceResult>): LessonCredit[] {
  const pair = lessonLanguagePair(lesson);
  if (!plan || !pair || lesson.type === "phrase") return [];
  const segments = new Map(lesson.segments.map((segment) => [segment.id, segment]));
  const byCard = new Map<string, LessonCredit>();
  for (const prompt of plan.windows) {
    const result = results[prompt.id];
    const answer = segments.get(prompt.answerId);
    if (!result || !answer || answer.phase === "buildup" || answer.phase === "warmup") continue;
    const level = phraseMatch(prompt.expected, result, plan.language).level;
    if (level !== "matched" && level !== "retry") continue;
    const card = makeCard(prompt.expected, prompt.translation ?? prompt.expected, pair);
    if (!card) continue;
    const previous = byCard.get(card.id);
    byCard.set(card.id, { card, matched: level === "matched" || previous?.matched === true });
  }
  return [...byCard.values()];
}
