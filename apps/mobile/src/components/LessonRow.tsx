import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import type { Lesson } from "@resolingo/shared";
import { Card } from "./Card";
import { Body, Heading } from "./Typography";
import { useTheme } from "@/theme/tokens";

const statusLabel: Record<Lesson["status"], string> = {
  queued: "Queued", generating_content: "Writing lesson", synthesizing_audio: "Creating audio", ready: "Ready", failed: "Needs attention",
};

export function LessonRow({ lesson }: { lesson: Lesson }) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${lesson.title}, ${statusLabel[lesson.status]}`} onPress={() => router.push(`/lesson/${lesson.id}`)}>
      <Card style={styles.card}>
        <View style={[styles.badge, { backgroundColor: lesson.type === "grammar" ? theme.mint : theme.amber }]}><Body style={styles.badgeText}>{lesson.type === "grammar" ? "G" : "C"}</Body></View>
        <View style={styles.copy}><Heading numberOfLines={2}>{lesson.title}</Heading><Body muted>{statusLabel[lesson.status]} · {lesson.type === "grammar" ? "Grammar" : "Conversation"}</Body></View>
        <Body muted>›</Body>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center" }, badge: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" }, badgeText: { color: "#08152F", fontWeight: "800" }, copy: { flex: 1, gap: 2 },
});
