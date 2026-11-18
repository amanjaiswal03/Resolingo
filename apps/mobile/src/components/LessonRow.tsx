import { useRef } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { runOnJS, useAnimatedReaction, type SharedValue } from "react-native-reanimated";
import { lessonCanBeDeleted, type Lesson } from "@resolingo/shared";
import { useLessonDelete } from "@/lessons/delete-lesson";
import { useTheme } from "@/theme/tokens";
import { Card } from "./Card";
import { Body, Heading } from "./Typography";

const kindLabel = { conversation: "Conversation", grammar: "Grammar", phrase: "Phrase" } as const;
const kindMark = { conversation: "C", grammar: "G", phrase: "P" } as const;
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

export function LessonRow({ lesson }: { lesson: Lesson }) {
  const router = useRouter();
  const theme = useTheme();
  const { requestDelete, registerOpenRow, releaseOpenRow, closeOpenRow, openRowId } = useLessonDelete();
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
      { text: "Cancel", style: "cancel" },
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
        <DeleteAction translation={translation} onArmed={() => { armed.current = true; }} onPress={remove} />
      ) } : {})}
      onSwipeableWillOpen={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (row.current) registerOpenRow(lesson.id, row.current);
      }}
      onSwipeableOpen={() => {
        if (!armed.current) return;
        armed.current = false;
        remove();
      }}
      onSwipeableClose={() => {
        armed.current = false;
        releaseOpenRow(lesson.id);
      }}
      containerStyle={[styles.swipe, styles.aboveDismiss]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${lesson.title}, ${statusLabel[lesson.status]}`}
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
          router.push(`/lesson/${lesson.id}`);
        }}
        onLongPress={confirm}
      >
        <Card style={styles.card}>
          <View style={[styles.badge, { backgroundColor: lesson.type === "grammar" ? theme.mint : lesson.type === "phrase" ? theme.coral : theme.amber }]}><Body style={styles.badgeText}>{kindMark[lesson.type]}</Body></View>
          <View style={styles.copy}><Heading numberOfLines={2}>{lesson.title}</Heading><Body muted>{statusLabel[lesson.status]} · {kindLabel[lesson.type]}</Body></View>
          <Body muted>›</Body>
        </Card>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  swipe: { borderRadius: 22 },
  aboveDismiss: { zIndex: 2 },
  action: { height: "100%", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "#BA1A1A" },
  actionLabel: { color: "#FFFFFF", fontSize: 13, lineHeight: 16, fontWeight: "700" },
  trash: { width: 22, height: 22, alignItems: "center" },
  trashHandle: { width: 8, height: 2, backgroundColor: "#FFFFFF", borderRadius: 1 },
  trashLid: { width: 18, height: 2, backgroundColor: "#FFFFFF", borderRadius: 1, marginTop: 2, marginBottom: 2 },
  trashBin: { width: 14, height: 12, borderWidth: 2, borderTopWidth: 0, borderColor: "#FFFFFF", borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  card: { flexDirection: "row", alignItems: "center" },
  badge: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#08152F", fontWeight: "800" },
  copy: { flex: 1, gap: 2 },
});
