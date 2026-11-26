import { useRef } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { runOnJS, useAnimatedReaction, type SharedValue } from "react-native-reanimated";
import { lessonCanBeDeleted, type Lesson } from "@resolingo/shared";
import { useLessonDelete } from "@/lessons/delete-lesson";
import { progressRatio, remainingLabel, type LessonProgress } from "@/playback/lesson-progress";
import { useLessonProgress } from "@/playback/LessonProgressProvider";
import { usePlayback } from "@/playback/PlaybackProvider";
import { percentWidth } from "@/lesson/navigation";
import { lessonAccent } from "@/theme/colors";
import { useTheme } from "@/theme/tokens";
import { LessonArtwork } from "./LessonArtwork";
import { PlayGlyph } from "./PlayGlyph";
import { PressableScale } from "./PressableScale";
import { Body, Heading } from "./Typography";

const kindLabel = { conversation: "Conversation", grammar: "Grammar", phrase: "Phrase" } as const;
const ACTION_WIDTH = 96;
const FULL_SWIPE = -160;

const statusLabel: Record<Lesson["status"], string> = {
  queued: "Queued", generating_content: "Writing lesson", synthesizing_audio: "Creating audio", ready: "Ready", failed: "Needs attention",
};

function DeleteAction({ translation, onArmed, onPress }: { translation: SharedValue<number>; onArmed: () => void; onPress: () => void }) {
  useAnimatedReaction(
    () => translation.value < FULL_SWIPE,
    (armed, previous) => {
      if (armed && !previous) runOnJS(onArmed)();
    },
  );
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Delete lesson" onPress={onPress} style={[styles.action, { width: ACTION_WIDTH }]}>
      <View style={styles.trash} accessibilityElementsHidden>
        <View style={styles.trashHandle} />
        <View style={styles.trashLid} />
        <View style={styles.trashBin} />
      </View>
      <Body style={styles.actionLabel}>Delete</Body>
    </Pressable>
  );
}

function metaLine(lesson: Lesson, saved?: LessonProgress): string {
  const minutes = lesson.manifest?.totalDurationMs ? ` · ${Math.max(1, Math.round(lesson.manifest.totalDurationMs / 60_000))} min` : "";
  if (lesson.status !== "ready") return `${statusLabel[lesson.status]} · ${kindLabel[lesson.type]}`;
  if (saved) return `${kindLabel[lesson.type]} · ${remainingLabel(saved)}`;
  return `${kindLabel[lesson.type]}${minutes}`;
}

export function LessonRow({ lesson }: { lesson: Lesson }) {
  const router = useRouter();
  const theme = useTheme();
  const { requestDelete, registerOpenRow, releaseOpenRow, closeOpenRow, openRowId } = useLessonDelete();
  const { lessonId, open } = usePlayback();
  const playing = lessonId === lesson.id;
  const saved = useLessonProgress().progress[lesson.id];
  // Only a lesson left in the middle shows how far the learner got.
  const heard = lesson.status === "ready" ? progressRatio(saved) : null;
  const inProgress = heard != null ? saved : undefined;
  const row = useRef<SwipeableMethods>(null);
  const armed = useRef(false);
  const deletable = lessonCanBeDeleted(lesson.status);
  const remove = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    requestDelete(lesson);
  };
  const confirm = () => {
    if (!deletable) {
      Alert.alert("Still being created", "You can delete this lesson once it’s ready.");
      return;
    }
    Alert.alert("Delete this lesson?", "You can undo it for a few seconds.", [
      { text: "Cancel", style: "cancel", onPress: () => row.current?.close() },
      { text: "Delete", style: "destructive", onPress: remove },
    ]);
  };
  return (
    <ReanimatedSwipeable
      ref={row}
      enabled={deletable}
      friction={1}
      overshootFriction={1}
      rightThreshold={48}
      {...(deletable ? { renderRightActions: (_progress: SharedValue<number>, translation: SharedValue<number>) => (
        <DeleteAction translation={translation} onArmed={() => { armed.current = true; }} onPress={confirm} />
      ) } : {})}
      onSwipeableWillOpen={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (row.current) registerOpenRow(lesson.id, row.current);
      }}
      onSwipeableOpen={() => {
        if (!armed.current) return;
        armed.current = false;
        confirm();
      }}
      onSwipeableClose={() => {
        armed.current = false;
        releaseOpenRow(lesson.id);
      }}
      containerStyle={[styles.swipe, styles.aboveDismiss]}
    >
      {/* Stays full size while the card sinks, so the delete action underneath never peeks out on a tap. */}
      <View style={[styles.cover, { backgroundColor: theme.surface }]}>
        <PressableScale haptic="none" scaleTo={0.98}
          accessibilityRole="button"
          accessibilityLabel={`${lesson.title}, ${playing ? "Playing" : metaLine(lesson, inProgress)}${lesson.status === "ready" && lesson.completed && !inProgress ? ", done" : ""}`}
          accessibilityHint={deletable ? "Swipe left to delete, or long press for a delete menu." : "This lesson is still being created."}
          accessibilityActions={deletable ? [{ name: "delete", label: "Delete lesson" }] : undefined}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "delete") confirm();
          }}
          onPress={() => {
            if (openRowId) {
              closeOpenRow();
              return;
            }
            if (lesson.status === "ready") open(lesson.id, { expand: true });
            else router.push(`/lesson/${lesson.id}`);
          }}
          onLongPress={confirm}
        >
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: playing ? theme.brand : theme.border }]}>
          <LessonArtwork lesson={lesson} size={56} radius={14} />
          <View style={styles.copy}>
            <Heading numberOfLines={2} style={styles.title}>{lesson.title}</Heading>
            <View style={styles.metaRow}>
              <View style={[styles.typeDot, { backgroundColor: lessonAccent(theme, lesson.type) }]} />
              <Body muted numberOfLines={1} style={styles.meta}>{metaLine(lesson, inProgress)}</Body>
              {lesson.status === "ready" && lesson.completed && !playing && !inProgress ? <Text style={[styles.done, { color: theme.success }]}>✓ Done</Text> : null}
            </View>
            {heard != null ? (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.heardTrack, { backgroundColor: theme.surfaceMuted }]}>
                <View style={[styles.heardFill, { backgroundColor: theme.brand, width: percentWidth(heard * 100) }]} />
              </View>
            ) : null}
          </View>
          {lesson.status === "ready" ? (
            <View style={[styles.play, { backgroundColor: playing ? theme.primaryFill : theme.primaryTint }]}>
              {playing ? <Text style={[styles.playingText, { color: theme.onPrimary }]}>♪</Text> : <PlayGlyph playing={false} color={theme.primary} size={14} />}
            </View>
          ) : <Body muted>›</Body>}
          </View>
        </PressableScale>
      </View>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  swipe: { borderRadius: 22 },
  cover: { borderRadius: 22, overflow: "hidden" },
  aboveDismiss: { zIndex: 2 },
  action: { height: "100%", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "#BA1A1A" },
  actionLabel: { color: "#FFFFFF", fontSize: 13, lineHeight: 16, fontWeight: "700" },
  trash: { width: 22, height: 22, alignItems: "center" },
  trashHandle: { width: 8, height: 2, backgroundColor: "#FFFFFF", borderRadius: 1 },
  trashLid: { width: 18, height: 2, backgroundColor: "#FFFFFF", borderRadius: 1, marginTop: 2, marginBottom: 2 },
  trashBin: { width: 14, height: 12, borderWidth: 2, borderTopWidth: 0, borderColor: "#FFFFFF", borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 10, paddingLeft: 10, paddingRight: 14, gap: 12 },
  copy: { flex: 1, gap: 3 },
  title: { fontSize: 16, lineHeight: 21 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  typeDot: { width: 7, height: 7, borderRadius: 4 },
  meta: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  heardTrack: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 4, marginRight: 8 },
  heardFill: { height: 4, borderRadius: 2 },
  done: { fontSize: 12, lineHeight: 16, fontWeight: "700", marginLeft: 4 },
  play: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  playingText: { fontSize: 16, lineHeight: 20, fontWeight: "800" },
});
