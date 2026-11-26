import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/Button";
import { FadeIn } from "@/components/FadeIn";
import { LessonRow } from "@/components/LessonRow";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { LessonRowDismiss, useLessonList } from "@/lessons/delete-lesson";
import { showHowWouldYouSayLesson } from "@/features";
import { calendarDateInZone, groupLessonsByDate } from "@/lessons/group-by-date";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

export default function HistoryScreen() {
  const { profile } = useSession();
  const { lessons, loading, error, closeOpenRow } = useLessonList();
  const router = useRouter();
  const theme = useTheme();
  const today = calendarDateInZone(profile?.timezone ?? "UTC");
  const ready = useMemo(
    () => lessons.filter((lesson) => lesson.status === "ready" && showHowWouldYouSayLesson(lesson.type)),
    [lessons],
  );
  const groups = useMemo(() => groupLessonsByDate(ready, today), [ready, today]);
  const done = ready.filter((lesson) => lesson.completed).length;
  if (loading) return <LoadingScreen />;
  return (
    <Screen onScrollBeginDrag={closeOpenRow} style={styles.content}>
      <LessonRowDismiss />
      <View style={styles.header} onTouchStart={closeOpenRow}>
        <Title>Your lessons</Title>
        {ready.length ? (
          <Body muted style={styles.summary}>
            {ready.length} {ready.length === 1 ? "lesson" : "lessons"} · {done} finished · Swipe left to delete
          </Body>
        ) : null}
      </View>
      {error ? <Body>We couldn’t load your lessons. Check your connection and try again.</Body> : null}
      {!ready.length ? (
        <View style={styles.empty}>
          <View style={[styles.emptyMark, { backgroundColor: theme.primaryTint }]}><Text style={styles.emptyEmoji}>🎧</Text></View>
          <Heading style={styles.centered}>No lessons yet</Heading>
          <Body muted style={styles.centered}>Every lesson you make lands here, ready for another listen.</Body>
          <Button label="Make your first lesson" onPress={() => router.navigate("/(tabs)")} />
        </View>
      ) : groups.map((group, groupIndex) => (
        <FadeIn key={group.date} index={groupIndex} style={styles.group}>
          <Text accessibilityRole="header" style={[styles.date, { color: theme.textMuted }]}>{group.label.toUpperCase()}</Text>
          {group.lessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} />)}
        </FadeIn>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 22 },
  header: { gap: 6, zIndex: 2 },
  summary: { fontSize: 14, lineHeight: 20 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 12, zIndex: 2 },
  emptyMark: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyEmoji: { fontSize: 32, lineHeight: 40 },
  centered: { textAlign: "center" },
  group: { gap: 10, zIndex: 2 },
  date: { fontSize: 12, lineHeight: 16, fontWeight: "800", letterSpacing: 1.2 },
});
