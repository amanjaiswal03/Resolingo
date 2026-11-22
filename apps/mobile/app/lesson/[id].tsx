import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Lesson } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Title } from "@/components/Typography";
import { HOW_WOULD_YOU_SAY_ENABLED } from "@/features";
import { firstRouteParam, lessonExit, percentWidth } from "@/lesson/navigation";
import { usePlayback } from "@/playback/PlaybackProvider";
import { api } from "@/services/api";
import { subscribeLesson } from "@/services/lessons";
import { report } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

export default function LessonScreen() {
  const id = firstRouteParam(useLocalSearchParams<{ id?: string | string[] }>().id);
  const { user } = useSession();
  const { open } = usePlayback();
  const router = useRouter();
  const theme = useTheme();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [removedFor, setRemovedFor] = useState<string | null>(null);
  const loadedId = useRef<string | null>(null);
  const handedOff = useRef(false);
  const leave = () => {
    if (lessonExit(router.canGoBack()) === "home") router.dismissTo("/(tabs)");
    else router.replace("/(tabs)");
  };
  useEffect(() => {
    if (!user || !id) return;
    let active = true;
    const unsubscribe = subscribeLesson(user.uid, id, (next) => {
      if (!active) return;
      if (next) {
        loadedId.current = id;
        setRemovedFor(null);
        setLesson(next);
        return;
      }
      setLesson(null);
      if (loadedId.current === id) setRemovedFor(id);
    }, (error) => {
      if (!active) return;
      report(error);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user, id]);
  useEffect(() => {
    if (HOW_WOULD_YOU_SAY_ENABLED || lesson?.type !== "phrase" || handedOff.current) return;
    handedOff.current = true;
    if (lessonExit(router.canGoBack()) === "home") router.dismissTo("/(tabs)");
    else router.replace("/(tabs)");
  }, [lesson?.type, router]);
  useEffect(() => {
    if (lesson?.status !== "ready" || !id || handedOff.current) return;
    if (!HOW_WOULD_YOU_SAY_ENABLED && lesson.type === "phrase") return;
    handedOff.current = true;
    open(id, { expand: true });
    if (lessonExit(router.canGoBack()) === "home") router.dismissTo("/(tabs)");
    else router.replace("/(tabs)");
  }, [id, lesson?.status, open, router]);
  if (id && removedFor === id) {
    return (
      <Screen style={styles.center}>
        <Title style={styles.centerText}>This lesson was deleted</Title>
        <Body muted style={styles.centerText}>It’s no longer in your list.</Body>
        <Button label="Back to today" variant="secondary" onPress={leave} />
      </Screen>
    );
  }
  if (!lesson || !user || lesson.status === "ready" || (!HOW_WOULD_YOU_SAY_ENABLED && lesson.type === "phrase")) return <LoadingScreen />;
  const retry = async () => {
    if (!id) return;
    setRetrying(true);
    try { await api.retryFailedLesson(id); } catch (error) { Alert.alert("Couldn’t retry", String(error)); } finally { setRetrying(false); }
  };
  return (
    <Screen style={styles.center}>
      <View style={[styles.orb, { backgroundColor: lesson.status === "failed" ? theme.danger : theme.primaryFill }]}><Body style={styles.orbText}>{lesson.status === "failed" ? "!" : "✦"}</Body></View>
      <Title style={styles.centerText}>{lesson.status === "failed" ? "This lesson hit a snag" : lesson.title}</Title>
      <Body muted style={styles.centerText}>{lesson.status === "queued" ? "Your lesson is safely queued." : lesson.status === "generating_content" ? "Choosing a fresh topic and writing your script." : lesson.status === "synthesizing_audio" ? "Giving every part a natural voice." : "No daily quota was used. You can try again."}</Body>
      {lesson.status !== "failed" ? <View style={[styles.progress, { backgroundColor: theme.border }]}><View style={[styles.progressFill, { backgroundColor: theme.brand, width: percentWidth(lesson.progress) }]} /></View> : null}
      <Body muted>{lesson.status === "failed" ? lesson.failureCode : `${lesson.progress}% complete · You can leave this screen`}</Body>
      {lesson.status === "failed" ? <Button label="Try again" loading={retrying} onPress={() => void retry()} /> : null}
      <Button label="Back to today" variant="secondary" onPress={leave} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: 18 },
  centerText: { textAlign: "center" },
  orb: { width: 82, height: 82, borderRadius: 41, alignItems: "center", justifyContent: "center" },
  orbText: { color: "#FFFFFF", fontSize: 32, fontWeight: "800" },
  progress: { width: "100%", height: 10, borderRadius: 5, overflow: "hidden" },
  progressFill: { height: 10, borderRadius: 5 },
});
