import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { LessonRow } from "@/components/LessonRow";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Title } from "@/components/Typography";
import { LessonRowDismiss, useLessonList } from "@/lessons/delete-lesson";
import { showHowWouldYouSayLesson } from "@/features";
import { calendarDateInZone, groupLessonsByDate } from "@/lessons/group-by-date";
import { useSession } from "@/session/SessionProvider";

export default function HistoryScreen() {
  const { profile } = useSession();
  const { lessons, loading, error, closeOpenRow } = useLessonList();
  const today = calendarDateInZone(profile?.timezone ?? "UTC");
  const ready = useMemo(
    () => lessons.filter((lesson) => lesson.status === "ready" && showHowWouldYouSayLesson(lesson.type)),
    [lessons],
  );
  const groups = useMemo(() => groupLessonsByDate(ready, today), [ready, today]);
  if (loading) return <LoadingScreen />;
  return (
    <Screen onScrollBeginDrag={closeOpenRow}>
      <LessonRowDismiss />
      <View style={styles.header} onTouchStart={closeOpenRow}><Title>Your lessons</Title><Body muted>Swipe left to delete a lesson. Everything else stays here for another listen.</Body></View>
      {error ? <Body>We couldn’t load your lessons. Check your connection and try again.</Body> : null}
      {!ready.length ? <View style={styles.empty}><Body muted>Your first generated lesson will appear here.</Body></View> : groups.map((group) => (
        <View key={group.date} style={styles.group}>
          <Body style={styles.date}>{group.label}</Body>
          {group.lessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} />)}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 7, marginBottom: 6, zIndex: 2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", zIndex: 2 },
  group: { gap: 12, zIndex: 2 },
  date: { fontWeight: "700" },
});
