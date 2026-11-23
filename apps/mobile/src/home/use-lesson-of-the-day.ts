import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import type { DailyPick } from "@resolingo/shared";
import { api } from "@/services/api";
import { report } from "@/services/telemetry";

/**
 * Today's lesson of the day. It is fetched when the home tab comes into view
 * and when the app returns to the foreground, so a new day brings a new pick.
 * A failed fetch keeps the last pick and simply hides the card if there is none.
 */
export function useLessonOfTheDay(today: string, enabled: boolean) {
  const [pick, setPick] = useState<DailyPick | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await api.getLessonOfTheDay();
      setPick(result.pick);
    } catch (error) {
      report(error);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [enabled]);

  // Focus covers the first visit; a new day is picked up on focus or when the app comes back.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => { if (next === "active") void refresh(); });
    return () => subscription.remove();
  }, [refresh]);

  /** Remember the lesson as soon as it is started, before the next fetch. */
  const markStarted = useCallback((lessonId: string) => {
    setPick((current) => current ? { ...current, lessonId } : current);
  }, []);

  const current = pick && today && pick.date !== today ? null : pick;
  return { pick: current, loading: loading && !pick, refresh, markStarted };
}
