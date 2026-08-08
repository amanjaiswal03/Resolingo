import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Lesson } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { LessonPlayer } from "@/components/LessonPlayer";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { api } from "@/services/api";
import { markLessonCompleted, resolveAudioUrls, subscribeLesson } from "@/services/lessons";
import { report, track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useSession();
  const router = useRouter();
  const theme = useTheme();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [resolved, setResolved] = useState<Lesson | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  useEffect(() => { if (user && id) return subscribeLesson(user.uid, id, setLesson); }, [user, id]);
  useEffect(() => {
    if (lesson?.status === "ready") void resolveAudioUrls(lesson).then(setResolved).catch((error) => { report(error); Alert.alert("Audio unavailable", "Please check your connection and try again."); });
  }, [lesson]);
  const complete = useCallback(async () => {
    if (!user || !id || !lesson) return;
    await markLessonCompleted(user.uid, id);
    if (profile?.telemetryConsent) await track("lesson_completed", { type: lesson.type });
  }, [id, lesson, profile?.telemetryConsent, user]);
  const lessonType = lesson?.type;
  const started = useCallback(() => {
    if (profile?.telemetryConsent && lessonType) void track("playback_started", { type: lessonType });
  }, [lessonType, profile?.telemetryConsent]);
  if (!lesson || !user || !id) return <LoadingScreen />;
  const retry = async () => { setRetrying(true); try { await api.retryFailedLesson(id); } catch (error) { Alert.alert("Couldn’t retry", String(error)); } finally { setRetrying(false); } };
  if (lesson.status !== "ready") {
    return (
      <Screen style={styles.center}>
        <View style={[styles.orb, { backgroundColor: lesson.status === "failed" ? theme.danger : theme.primary }]}><Body style={styles.orbText}>{lesson.status === "failed" ? "!" : "✦"}</Body></View>
        <Title style={styles.centerText}>{lesson.status === "failed" ? "This lesson hit a snag" : lesson.title}</Title>
        <Body muted style={styles.centerText}>{lesson.status === "queued" ? "Your lesson is safely queued." : lesson.status === "generating_content" ? "Choosing a fresh topic and writing your script." : lesson.status === "synthesizing_audio" ? "Giving every part a natural voice." : "No daily quota was used. You can try again."}</Body>
        {lesson.status !== "failed" ? <View style={[styles.progress, { backgroundColor: theme.border }]}><View style={[styles.progressFill, { backgroundColor: theme.primary, width: `${lesson.progress}%` }]} /></View> : null}
        <Body muted>{lesson.status === "failed" ? lesson.failureCode : `${lesson.progress}% complete · You can leave this screen`}</Body>
        {lesson.status === "failed" ? <Button label="Try again" loading={retrying} onPress={() => void retry()} /> : null}
        <Button label="Back to today" variant="secondary" onPress={() => router.replace("/(tabs)")} />
      </Screen>
    );
  }
  if (!resolved) return <LoadingScreen />;
  return (
    <Screen>
      <Button label="‹ Back" variant="ghost" onPress={() => router.back()} />
      <View style={styles.header}><Body muted>{lesson.type.toUpperCase()} · 3–5 MINUTES</Body><Title>{lesson.title}</Title><Body muted>{lesson.summary}</Body></View>
      <LessonPlayer lesson={resolved} onComplete={complete} onStart={started} onSegmentChange={setActiveSegmentId} />
      <Heading>Transcript</Heading>
      {resolved.segments.map((segment) => <Card key={segment.id} style={segment.id === activeSegmentId ? { backgroundColor: theme.surfaceMuted, borderColor: theme.primary, borderWidth: 2 } : undefined}><Body muted>{segment.speaker === "teacher" ? "TEACHER" : segment.speaker === "speakerA" ? "SPEAKER A" : "SPEAKER B"}</Body><Body>{segment.text}</Body>{segment.translation ? <Body muted>{segment.translation}</Body> : null}{segment.transliteration ? <Body muted>{segment.transliteration}</Body> : null}</Card>)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: 18 }, centerText: { textAlign: "center" }, orb: { width: 82, height: 82, borderRadius: 41, alignItems: "center", justifyContent: "center" }, orbText: { color: "#FFFFFF", fontSize: 32, fontWeight: "800" }, progress: { width: "100%", height: 10, borderRadius: 5, overflow: "hidden" }, progressFill: { height: 10, borderRadius: 5 }, header: { gap: 7 },
});
