import { useCallback, useEffect, useRef, useState } from "react";
import type { Lesson } from "@resolingo/shared";
import { subscribeLessons } from "@/services/lessons";
import { useSession } from "@/session/SessionProvider";

const PROGRESS_REFRESH_MS = 400;

function shapeChanged(previous: readonly Lesson[], next: readonly Lesson[]): boolean {
  if (previous.length !== next.length) return true;
  return next.some((lesson, index) => {
    const before = previous[index];
    return !before || before.id !== lesson.id || before.status !== lesson.status;
  });
}

type Loaded = { key: string; lessons: Lesson[] | null; error: Error | null };

export function useLessons() {
  const { user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const uid = user?.uid;
  // Results belong to one learner and one attempt, so a new learner or a retry starts from the skeleton.
  const key = uid ? `${uid}:${attempt}` : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const shown = useRef<Lesson[]>([]);
  const pending = useRef<Lesson[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!uid || !key) return;
    shown.current = [];
    let first = true;
    const publish = (next: Lesson[]) => {
      first = false;
      shown.current = next;
      setLoaded({ key, lessons: next, error: null });
    };
    const unsubscribe = subscribeLessons(uid, (next) => {
      if (first || shapeChanged(shown.current, next)) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        pending.current = null;
        publish(next);
        return;
      }
      pending.current = next;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (pending.current) publish(pending.current);
        pending.current = null;
      }, PROGRESS_REFRESH_MS);
    }, (nextError) => setLoaded((previous) => ({ key, lessons: previous?.key === key ? previous.lessons : null, error: nextError })));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      unsubscribe();
    };
  }, [uid, key]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = loaded && loaded.key === key ? loaded : null;
  return {
    lessons: current?.lessons ?? EMPTY,
    loading: !current || (current.lessons === null && !current.error),
    error: current?.error ?? null,
    retry,
  };
}

const EMPTY: Lesson[] = [];
