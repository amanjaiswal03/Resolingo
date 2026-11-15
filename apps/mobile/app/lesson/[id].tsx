import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { lessonDisplayText, speakerLabel, type Lesson } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { LessonPlayer } from "@/components/LessonPlayer";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { firstRouteParam, lessonExit, percentWidth } from "@/lesson/navigation";
import { api } from "@/services/api";
import { markLessonCompleted, resolveAudioUrls, subscribeLesson } from "@/services/lessons";
import { report, track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

export default function LessonScreen() {
  const id = firstRouteParam(useLocalSearchParams<{ id?: string | string[] }>().id);
  const { user, profile } = useSession();
  const router = useRouter();
  const theme = useTheme();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [resolved, setResolved] = useState<Lesson | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState<{ id: string; token: number } | null>(null);
  const transcriptRef = useRef<ScrollView>(null);
  const transcriptOffsets = useRef<Record<string, number>>({});
  const leave = () => {
    if (lessonExit(router.canGoBack()) === "back") router.back();
    else router.replace("/(tabs)");
  };
  useEffect(() => {
    if (!user || !id) return;
    let active = true;
    const unsubscribe = subscribeLesson(user.uid, id, (next) => {
      if (active) setLesson(next);
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
    if (lesson?.status !== "ready") return;
    let cancelled = false;
    void resolveAudioUrls(lesson).then((next) => {
      if (!cancelled) setResolved(next);
    }).catch((error: unknown) => {
      if (cancelled) return;
      report(error);
      Alert.alert("Audio unavailable", "Please check your connection and try again.");
    });
    return () => { cancelled = true; };
  }, [lesson]);
  const complete = useCallback(async () => {
    if (!user || !id || !lesson) return;
    await markLessonCompleted(user.uid, id);
    if (profile?.telemetryConsent) await track("lesson_completed", { type: lesson.type });
  }, [id, lesson, profile?.telemetryConsent, user]);
  useEffect(() => {
    if (!activeSegmentId) return;
    const offset = transcriptOffsets.current[activeSegmentId];
    if (offset == null) return;
    transcriptRef.current?.scrollTo({ y: Math.max(0, offset - 8), animated: true });
  }, [activeSegmentId]);
  const lessonType = lesson?.type;
  const started = useCallback(() => {
    if (profile?.telemetryConsent && lessonType) void track("playback_started", { type: lessonType });
  }, [lessonType, profile?.telemetryConsent]);
  // Keep the loaded lesson mounted while the route param drops during a pop.
  // Swapping in a spinner here unmounts the player mid-gesture.
  if (!lesson || !user) return <LoadingScreen />;
  const retry = async () => {
    if (!id) return;
    setRetrying(true);
    try { await api.retryFailedLesson(id); } catch (error) { Alert.alert("Couldn’t retry", String(error)); } finally { setRetrying(false); }
  };
  if (lesson.status !== "ready") {
    return (
      <Screen style={styles.center}>
        <View style={[styles.orb, { backgroundColor: lesson.status === "failed" ? theme.danger : theme.primary }]}><Body style={styles.orbText}>{lesson.status === "failed" ? "!" : "✦"}</Body></View>
        <Title style={styles.centerText}>{lesson.status === "failed" ? "This lesson hit a snag" : lesson.title}</Title>
        <Body muted style={styles.centerText}>{lesson.status === "queued" ? "Your lesson is safely queued." : lesson.status === "generating_content" ? "Choosing a fresh topic and writing your script." : lesson.status === "synthesizing_audio" ? "Giving every part a natural voice." : "No daily quota was used. You can try again."}</Body>
        {lesson.status !== "failed" ? <View style={[styles.progress, { backgroundColor: theme.border }]}><View style={[styles.progressFill, { backgroundColor: theme.primary, width: percentWidth(lesson.progress) }]} /></View> : null}
        <Body muted>{lesson.status === "failed" ? lesson.failureCode : `${lesson.progress}% complete · You can leave this screen`}</Body>
        {lesson.status === "failed" ? <Button label="Try again" loading={retrying} onPress={() => void retry()} /> : null}
        <Button label="Back to today" variant="secondary" onPress={leave} />
      </Screen>
    );
  }
  if (!resolved) return <LoadingScreen />;
  return (
    <Screen scroll={false}>
      <Button label="‹ Back" variant="ghost" onPress={leave} />
      <View style={styles.header}><Body muted style={styles.eyebrow}>{lesson.type.toUpperCase()}{lesson.manifest?.totalDurationMs ? ` · ${Math.max(1, Math.round(lesson.manifest.totalDurationMs / 60_000))} MIN` : ""}</Body><Title style={styles.title} numberOfLines={2}>{lesson.title}</Title><Body muted style={styles.summary} numberOfLines={2}>{lesson.summary}</Body></View>
      <ScrollView ref={transcriptRef} style={styles.transcript} contentContainerStyle={styles.transcriptContent} showsVerticalScrollIndicator={false}>
        <Heading>Transcript</Heading>
        {resolved.segments.map((segment) => {
          const active = resolved.segments.find((item) => item.id === activeSegmentId);
          const highlighted = segment.id === activeSegmentId || Boolean(active?.audioPath && segment.audioPath === active.audioPath);
          return <Pressable key={segment.id} accessibilityRole="button" accessibilityLabel="Play this part" onPress={() => setJumpTo({ id: segment.id, token: Date.now() })} onLayout={(event) => { transcriptOffsets.current[segment.id] = event.nativeEvent.layout.y; }}><Card style={highlighted ? { backgroundColor: theme.surfaceMuted, borderColor: theme.primary, borderWidth: 2 } : undefined}><Body muted>{speakerLabel(segment.speaker, resolved.speakerNames)}</Body><Body>{lessonDisplayText(segment.text)}</Body>{segment.translation ? <Body muted>{lessonDisplayText(segment.translation)}</Body> : null}{(segment.pauseAfterMs ?? 0) > 0 ? <Body muted>Say it aloud</Body> : null}{segment.transliteration ? <Body muted>{segment.transliteration}</Body> : null}</Card></Pressable>;
        })}
      </ScrollView>
      <LessonPlayer lesson={resolved} onComplete={complete} onStart={started} onSegmentChange={setActiveSegmentId} jumpTo={jumpTo} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: 18 }, centerText: { textAlign: "center" }, orb: { width: 82, height: 82, borderRadius: 41, alignItems: "center", justifyContent: "center" }, orbText: { color: "#FFFFFF", fontSize: 32, fontWeight: "800" }, progress: { width: "100%", height: 10, borderRadius: 5, overflow: "hidden" }, progressFill: { height: 10, borderRadius: 5 }, header: { gap: 2 }, eyebrow: { fontSize: 12, lineHeight: 16 }, title: { fontSize: 22, lineHeight: 26 }, summary: { fontSize: 14, lineHeight: 18 }, transcript: { flex: 1 }, transcriptContent: { gap: 16, paddingBottom: 8 },
});
