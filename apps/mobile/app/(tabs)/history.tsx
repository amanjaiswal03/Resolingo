import { StyleSheet, View } from "react-native";
import { LessonRow } from "@/components/LessonRow";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Title } from "@/components/Typography";
import { LessonRowDismiss, useLessonList } from "@/lessons/delete-lesson";

export default function HistoryScreen() {
  const { lessons, loading, error, closeOpenRow } = useLessonList();
  if (loading) return <LoadingScreen />;
  return (
    <Screen onScrollBeginDrag={closeOpenRow}>
      <LessonRowDismiss />
      <View style={styles.header} onTouchStart={closeOpenRow}><Title>Your lessons</Title><Body muted>Swipe left to delete a lesson. Everything else stays here for another listen.</Body></View>
      {error ? <Body>We couldn’t load your lessons. Check your connection and try again.</Body> : null}
      {!lessons.length ? <View style={styles.empty}><Body muted>Your first generated lesson will appear here.</Body></View> : lessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} />)}
    </Screen>
  );
}

const styles = StyleSheet.create({ header: { gap: 7, marginBottom: 6, zIndex: 2 }, empty: { flex: 1, alignItems: "center", justifyContent: "center", zIndex: 2 } });
