import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import type { Lesson } from "@resolingo/shared";
import { lessonCanBeDeleted } from "@resolingo/shared";
import { Body } from "@/components/Typography";
import { useLessons } from "@/hooks/useLessons";
import { api } from "@/services/api";
import { report } from "@/services/telemetry";
import { useTheme } from "@/theme/tokens";

const UNDO_MS = 5000;

type Hold = { id: string; quotaDate: string };

type DeleteContextValue = {
  lessons: Lesson[];
  loading: boolean;
  error: Error | null;
  retry: () => void;
  hiddenIds: ReadonlySet<string>;
  heldReadyDates: readonly string[];
  openRowId: string | null;
  closeOpenRow: () => void;
  registerOpenRow: (id: string, row: SwipeableMethods) => void;
  releaseOpenRow: (id: string) => void;
  requestDelete: (lesson: Lesson) => void;
  canDelete: (lesson: Lesson) => boolean;
};

const DeleteContext = createContext<DeleteContextValue | null>(null);

export function LessonDeleteProvider({ children }: PropsWithChildren) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { lessons: source, loading, error, retry } = useLessons();
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [holds, setHolds] = useState<readonly Hold[]>([]);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const openRow = useRef<SwipeableMethods | null>(null);
  const openId = useRef<string | null>(null);

  const restore = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setHiddenIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setHolds((current) => current.filter((hold) => hold.id !== id));
    setUndoId((current) => current === id ? null : current);
  }, []);

  const commit = useCallback((id: string) => {
    timers.current.delete(id);
    setUndoId((current) => current === id ? null : current);
    void api.deleteLesson(id).catch((error: unknown) => {
      report(error);
      restore(id);
      Alert.alert("Couldn’t delete that lesson", "It’s back in your list.");
    });
  }, [restore]);

  const requestDelete = useCallback((lesson: Lesson) => {
    if (!lessonCanBeDeleted(lesson.status) || timers.current.has(lesson.id)) return;
    openRow.current?.close();
    openRow.current = null;
    openId.current = null;
    setOpenRowId(null);
    setHiddenIds((current) => {
      const next = new Set(current);
      next.add(lesson.id);
      return next;
    });
    if (lesson.status === "ready") {
      setHolds((current) => current.some((hold) => hold.id === lesson.id) ? current : [...current, { id: lesson.id, quotaDate: lesson.quotaDate }]);
    }
    setUndoId(lesson.id);
    timers.current.set(lesson.id, setTimeout(() => commit(lesson.id), UNDO_MS));
  }, [commit]);

  const undo = useCallback(() => {
    if (undoId) restore(undoId);
  }, [restore, undoId]);

  useEffect(() => () => {
    const pending = [...timers.current.keys()];
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    for (const id of pending) void api.deleteLesson(id).catch((error: unknown) => report(error));
  }, []);

  const closeOpenRow = useCallback(() => {
    openRow.current?.close();
    openRow.current = null;
    openId.current = null;
    setOpenRowId(null);
  }, []);

  const registerOpenRow = useCallback((id: string, row: SwipeableMethods) => {
    if (openId.current && openId.current !== id) openRow.current?.close();
    openId.current = id;
    openRow.current = row;
    setOpenRowId(id);
  }, []);

  const releaseOpenRow = useCallback((id: string) => {
    if (openId.current !== id) return;
    openRow.current = null;
    openId.current = null;
    setOpenRowId(null);
  }, []);

  const value = useMemo<DeleteContextValue>(() => ({
    lessons: source,
    loading,
    error,
    retry,
    hiddenIds,
    heldReadyDates: holds.map((hold) => hold.quotaDate),
    openRowId,
    closeOpenRow,
    registerOpenRow,
    releaseOpenRow,
    requestDelete,
    canDelete: (lesson) => lessonCanBeDeleted(lesson.status),
  }), [closeOpenRow, error, hiddenIds, holds, loading, openRowId, registerOpenRow, releaseOpenRow, requestDelete, retry, source]);

  return (
    <DeleteContext.Provider value={value}>
      <View style={styles.fill}>
        {children}
        {undoId ? (
          <View style={[styles.snackbar, { backgroundColor: theme.navy, bottom: insets.bottom + 74 }]}>
            <Body style={styles.snackbarText} numberOfLines={1}>Lesson deleted</Body>
            <Pressable accessibilityRole="button" accessibilityLabel="Undo delete" onPress={undo} hitSlop={8}>
              <Body style={[styles.undo, { color: theme.onDark }]}>Undo</Body>
            </Pressable>
          </View>
        ) : null}
      </View>
    </DeleteContext.Provider>
  );
}

function useDeleteContext(): DeleteContextValue {
  const value = useContext(DeleteContext);
  if (!value) throw new Error("Lesson rows must sit inside the lessons tab.");
  return value;
}

export function useLessonList() {
  const { lessons: source, loading, error, retry, hiddenIds, heldReadyDates, closeOpenRow } = useDeleteContext();
  const lessons = source.filter((lesson) => !hiddenIds.has(lesson.id));
  return { lessons, loading, error, retry, heldReadyDates, closeOpenRow };
}

export function useLessonDelete() {
  return useDeleteContext();
}

export function LessonRowDismiss() {
  const { openRowId, closeOpenRow } = useDeleteContext();
  if (!openRowId) return null;
  return <Pressable accessibilityLabel="Close delete" style={styles.dismiss} onPress={closeOpenRow} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dismiss: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 },
  snackbar: { position: "absolute", left: 16, right: 16, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#08152F", shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  snackbarText: { color: "#FFFFFF", flex: 1 },
  undo: { fontWeight: "800" },
});
