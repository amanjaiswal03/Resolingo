import { useEffect, useState } from "react";
import type { Lesson } from "@resolingo/shared";
import { subscribeLessons } from "@/services/lessons";
import { useSession } from "@/session/SessionProvider";

export function useLessons() {
  const { user } = useSession();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!user) return;
    return subscribeLessons(user.uid, (next) => { setLessons(next); setLoading(false); }, (nextError) => { setError(nextError); setLoading(false); });
  }, [user]);
  return { lessons, loading, error };
}
