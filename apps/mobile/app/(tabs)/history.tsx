import { StyleSheet, View } from "react-native";
import { LessonRow } from "@/components/LessonRow";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Title } from "@/components/Typography";
import { useLessons } from "@/hooks/useLessons";

export default function HistoryScreen() {
  const { lessons, loading, error } = useLessons();
  if (loading) return <LoadingScreen />;
  return (
    <Screen>
      <View style={styles.header}><Title>Your lessons</Title><Body muted>Every lesson stays here, ready for another listen.</Body></View>
      {error ? <Body>We couldn’t load your lessons. Check your connection and try again.</Body> : null}
      {!lessons.length ? <View style={styles.empty}><Body muted>Your first generated lesson will appear here.</Body></View> : lessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} />)}
    </Screen>
  );
}

const styles = StyleSheet.create({ header: { gap: 7, marginBottom: 6 }, empty: { flex: 1, alignItems: "center", justifyContent: "center" } });
