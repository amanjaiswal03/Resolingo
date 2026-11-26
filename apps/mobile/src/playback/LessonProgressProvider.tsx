import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { File, Paths } from "expo-file-system";
import { saveLessonProgress, subscribeLessonProgress } from "@/services/lessons";
import { report } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import {
  capProgress,
  LOCAL_SAVE_EVERY_MS,
  mergeProgress,
  parseProgress,
  progressFromDocument,
  shouldSyncToCloud,
  type LessonProgress,
  type ProgressMap,
} from "./lesson-progress";

export type SaveReason = "tick" | "pause" | "leave" | "reset";

type LessonProgressStore = {
  progress: ProgressMap;
  /** Remember where playback is. Ticks are thinned out here, so callers can report often. */
  save: (lessonId: string, positionMs: number, durationMs: number, reason: SaveReason) => void;
};

const EMPTY: ProgressMap = {};
const LessonProgressContext = createContext<LessonProgressStore | null>(null);

function progressFile(uid: string): File {
  return new File(Paths.document, `lesson-progress-${uid.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

async function readLocal(uid: string): Promise<Record<string, LessonProgress>> {
  try {
    const file = progressFile(uid);
    return file.exists ? parseProgress(await file.text()) : {};
  } catch {
    return {};
  }
}

function writeLocal(uid: string, map: ProgressMap): void {
  try {
    const file = progressFile(uid);
    if (!file.exists) file.create();
    file.write(JSON.stringify(map));
  } catch {
    // The account copy still has it.
  }
}

export function LessonProgressProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const uid = user?.uid ?? null;
  // Tagged with its account, so a sign-out never shows the last learner's progress.
  const [stored, setStored] = useState<{ uid: string | null; map: ProgressMap }>({ uid: null, map: {} });
  const progress = stored.uid === uid ? stored.map : EMPTY;
  const current = useRef<Record<string, LessonProgress>>({});
  const lastLocal = useRef<Record<string, number>>({});
  const lastCloud = useRef<Record<string, number>>({});
  const publish = useCallback((owner: string, next: Record<string, LessonProgress>, persist: boolean) => {
    const capped = capProgress(next);
    current.current = capped;
    setStored({ uid: owner, map: capped });
    if (persist) writeLocal(owner, capped);
  }, []);
  useEffect(() => {
    current.current = {};
    lastLocal.current = {};
    lastCloud.current = {};
    if (!uid) return;
    let active = true;
    void readLocal(uid).then((local) => {
      if (active) publish(uid, mergeProgress(local, current.current), false);
    });
    const unsubscribe = subscribeLessonProgress(uid, (entries) => {
      const remote: Record<string, LessonProgress> = {};
      for (const { lessonId, data } of entries) {
        const entry = progressFromDocument(data);
        if (entry) remote[lessonId] = entry;
      }
      const merged = mergeProgress(current.current, remote);
      const changed = Object.keys(merged).some((id) => merged[id] !== current.current[id]);
      if (changed) publish(uid, merged, true);
    }, (error) => report(error));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [publish, uid]);
  const save = useCallback((lessonId: string, positionMs: number, durationMs: number, reason: SaveReason) => {
    const owner = uid;
    if (!owner || !Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) return;
    const now = Date.now();
    if (reason === "tick" && now - (lastLocal.current[lessonId] ?? 0) < LOCAL_SAVE_EVERY_MS) return;
    const entry: LessonProgress = {
      positionMs: Math.round(Math.min(Math.max(0, positionMs), durationMs)),
      durationMs: Math.round(durationMs),
      updatedAt: now,
    };
    lastLocal.current[lessonId] = now;
    publish(owner, { ...current.current, [lessonId]: entry }, true);
    if (!shouldSyncToCloud(reason, lastCloud.current[lessonId], now)) return;
    lastCloud.current[lessonId] = now;
    void saveLessonProgress(owner, lessonId, entry).catch(() => {
      // Offline writes queue on their own. A refused write keeps the device copy.
      delete lastCloud.current[lessonId];
    });
  }, [publish, uid]);
  const value = useMemo(() => ({ progress, save }), [progress, save]);
  return <LessonProgressContext.Provider value={value}>{children}</LessonProgressContext.Provider>;
}

export function useLessonProgress(): LessonProgressStore {
  const value = useContext(LessonProgressContext);
  if (!value) throw new Error("Lesson progress is unavailable.");
  return value;
}
