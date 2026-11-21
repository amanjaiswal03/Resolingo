import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { useSegments } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const MINI_PLAYER_HEIGHT = 76;
export const TAB_BAR_HEIGHT = 52;

type Playback = {
  lessonId: string | null;
  expanded: boolean;
  /** Space screens should keep clear above the docked bar. */
  contentInset: number;
  /** Distance from the bottom of the window to the docked bar. */
  dockBottom: number;
  open: (id: string, options?: { expand?: boolean }) => void;
  /** Lessons the learner has already opened, so Today can retire its ready card. */
  openedLessonIds: ReadonlySet<string>;
  openedLessonsReady: boolean;
  expand: () => void;
  collapse: () => void;
  close: () => void;
  pause: () => void;
  registerPause: (handler: () => void) => () => void;
  stopExample: () => void;
  registerExamplePause: (handler: () => void) => () => void;
};

const PlaybackContext = createContext<Playback | null>(null);
const OPENED_LESSONS_KEY = "opened-lesson-ids";
const OPENED_LESSON_LIMIT = 40;

function readOpenedIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string").slice(-OPENED_LESSON_LIMIT));
  } catch {
    return new Set();
  }
}

export function PlaybackProvider({ children }: PropsWithChildren) {
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [openedLessonIds, setOpenedLessonIds] = useState<ReadonlySet<string>>(new Set());
  const [openedLessonsReady, setOpenedLessonsReady] = useState(false);
  const lessonIdRef = useRef<string | null>(null);
  const pauseRef = useRef<(() => void) | null>(null);
  const examplePauseRef = useRef<(() => void) | null>(null);
  const openedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(OPENED_LESSONS_KEY).then((raw) => {
      if (!active) return;
      const ids = readOpenedIds(raw);
      openedRef.current = ids;
      setOpenedLessonIds(ids);
    }).catch(() => undefined).finally(() => {
      if (active) setOpenedLessonsReady(true);
    });
    return () => { active = false; };
  }, []);
  const rememberOpened = useCallback((id: string) => {
    if (openedRef.current.has(id)) return;
    const ids = new Set(openedRef.current);
    ids.add(id);
    const capped = new Set([...ids].slice(-OPENED_LESSON_LIMIT));
    openedRef.current = capped;
    setOpenedLessonIds(capped);
    void SecureStore.setItemAsync(OPENED_LESSONS_KEY, JSON.stringify([...capped])).catch(() => undefined);
  }, []);
  const open = useCallback((id: string, options?: { expand?: boolean }) => {
    const expand = options?.expand ?? true;
    lessonIdRef.current = id;
    setLessonId(id);
    setExpanded(expand);
    rememberOpened(id);
  }, [rememberOpened]);
  const expand = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => setExpanded(false), []);
  const close = useCallback(() => {
    lessonIdRef.current = null;
    setLessonId(null);
    setExpanded(false);
  }, []);
  const registerPause = useCallback((handler: () => void) => {
    pauseRef.current = handler;
    return () => {
      if (pauseRef.current === handler) pauseRef.current = null;
    };
  }, []);
  const pause = useCallback(() => pauseRef.current?.(), []);
  const stopExample = useCallback(() => examplePauseRef.current?.(), []);
  const registerExamplePause = useCallback((handler: () => void) => {
    examplePauseRef.current = handler;
    return () => {
      if (examplePauseRef.current === handler) examplePauseRef.current = null;
    };
  }, []);
  const onTabs = segments[0] === "(tabs)";
  const showingBar = lessonId != null && !expanded;
  const dockBottom = showingBar ? (onTabs ? TAB_BAR_HEIGHT : insets.bottom) : 0;
  const contentInset = showingBar ? MINI_PLAYER_HEIGHT + (onTabs ? 0 : insets.bottom) : 0;
  const value = useMemo(
    () => ({ lessonId, expanded, contentInset, dockBottom, open, openedLessonIds, openedLessonsReady, expand, collapse, close, pause, registerPause, stopExample, registerExamplePause }),
    [close, collapse, contentInset, dockBottom, expand, expanded, lessonId, open, openedLessonIds, openedLessonsReady, pause, registerExamplePause, registerPause, stopExample],
  );
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): Playback {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error("Playback is unavailable.");
  return value;
}
