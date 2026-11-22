import { useCallback, useEffect, useRef } from "react";
import { randomUUID } from "expo-crypto";
import type { Lesson } from "@resolingo/shared";
import type { AnswerPlan } from "@/lesson/answer-windows";
import type { VoiceResult } from "@/lesson/phrase-match";
import { useSession } from "@/session/SessionProvider";
import { lessonCredits } from "./lesson-credits";
import { lessonLanguagePair } from "./model";
import { recordLessonCredits } from "./progress";

export function useLessonCredits(lesson: Lesson, plan: AnswerPlan | null, results: Record<string, VoiceResult>) {
  const { user } = useSession();
  const latest = useRef({ lesson, plan, results, uid: user?.uid });
  useEffect(() => {
    latest.current = { lesson, plan, results, uid: user?.uid };
  });
  const sent = useRef(new Set<string>());

  const flush = useCallback(() => {
    const { lesson: current, plan: currentPlan, results: currentResults, uid } = latest.current;
    const pair = lessonLanguagePair(current);
    if (!uid || !pair) return;
    const fresh = lessonCredits(current, currentPlan, currentResults).filter(({ card }) => !sent.current.has(card.id));
    if (!fresh.length) return;
    for (const { card } of fresh) sent.current.add(card.id);
    void recordLessonCredits(uid, pair, fresh, randomUUID).catch(() => undefined);
  }, []);

  useEffect(() => {
    sent.current = new Set();
    return flush;
  }, [lesson.id, flush]);

  return flush;
}
