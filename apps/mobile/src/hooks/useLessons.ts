import { useEffect, useRef, useState } from "react";
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

export function useLessons() {
  const { user } = useSession();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const shown = useRef<Lesson[]>([]);
  const pending = useRef<Lesson[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user) return;
    const publish = (next: Lesson[]) => {
      shown.current = next;
      setLessons(next);
      setLoading(false);
    };
    const unsubscribe = subscribeLessons(user.uid, (next) => {
      if (shapeChanged(shown.current, next)) {
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
    }, (nextError) => { setError(nextError); setLoading(false); });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      unsubscribe();
    };
  }, [user]);
  return { lessons, loading, error };
}
