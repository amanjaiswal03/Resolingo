import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import type { LessonType } from "@resolingo/shared";
import { Card } from "@/components/Card";
import { LessonRow } from "@/components/LessonRow";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { dailyCapBlocksStart, dailyQuotaLabel, lessonsReadyToday } from "@/home/daily-quota";
import { LessonRowDismiss, useLessonList } from "@/lessons/delete-lesson";
import { percentWidth } from "@/lesson/navigation";
import { api } from "@/services/api";
import { subscribeReadyCount } from "@/services/lessons";
import { listenForPushTokenChanges, registerForPush } from "@/services/notifications";
import { report, track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

type DailyLessonType = Exclude<LessonType, "phrase">;

function dateInZone(zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default function HomeScreen() {
  const { user, profile } = useSession();
  const { lessons, loading, heldReadyDates, closeOpenRow } = useLessonList();
  const router = useRouter();
  const theme = useTheme();
  const [starting, setStarting] = useState<DailyLessonType | null>(null);
  const [recordedReady, setRecordedReady] = useState(0);
  useEffect(() => {
    if (!profile?.reminderEnabled) return;
    void registerForPush();
    const subscription = listenForPushTokenChanges();
    return () => subscription.remove();
  }, [profile?.reminderEnabled]);
  const today = profile ? dateInZone(profile.timezone) : "";
  useEffect(() => {
    if (!user || !today) return;
    return subscribeReadyCount(user.uid, today, setRecordedReady);
  }, [today, user]);
  const used = useMemo(() => lessonsReadyToday(
    lessons.filter((lesson) => lesson.quotaDate === today && lesson.status === "ready").length,
    heldReadyDates.filter((date) => date === today).length,
    recordedReady,
  ), [heldReadyDates, lessons, recordedReady, today]);
  const unlimited = profile?.unlimitedLessons === true;
  const active = lessons.find((lesson) => ["queued", "generating_content", "synthesizing_audio"].includes(lesson.status));
  const startDisabled = Boolean(starting || active) || dailyCapBlocksStart(used, unlimited);
  const start = async (type: DailyLessonType) => {
    setStarting(type);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await api.createDailyLesson(type, Crypto.randomUUID());
      if (profile?.telemetryConsent) await track("lesson_requested", { type });
      router.push(`/lesson/${result.lessonId}`);
    } catch (error) {
      report(error); Alert.alert("Couldn’t start a lesson", error instanceof Error ? error.message : "Please try again.");
    } finally { setStarting(null); }
  };
  if (loading || !profile) return <LoadingScreen />;
  return (
    <Screen onScrollBeginDrag={closeOpenRow}>
      <LessonRowDismiss />
      <View style={styles.header} onTouchStart={closeOpenRow}><Body muted>GOOD TO SEE YOU, {profile.nickname.toUpperCase()}</Body><Title>What will you practice?</Title><Body muted>{dailyQuotaLabel(used, unlimited)}</Body></View>
      {active ? <Pressable onPressIn={closeOpenRow} onPress={() => router.push(`/lesson/${active.id}`)} style={styles.above}><Card style={{ backgroundColor: theme.surfaceMuted }}><Body muted>IN PROGRESS</Body><Heading>{active.title}</Heading><View style={[styles.progressTrack, { backgroundColor: theme.border }]}><View style={[styles.progressFill, { backgroundColor: theme.primary, width: percentWidth(active.progress) }]} /></View><Body muted>{Number.isFinite(active.progress) ? active.progress : 0}% · Tap to follow progress</Body></Card></Pressable> : null}
      <View style={styles.choices}>
        <Pressable disabled={startDisabled} onPressIn={closeOpenRow} onPress={() => void start("conversation")} accessibilityRole="button" accessibilityLabel="Start a conversation lesson" style={{ opacity: startDisabled ? 0.5 : 1 }}>
          <Card style={[styles.lessonCard, { backgroundColor: theme.amber }]}><Body style={styles.eyebrow}>CONVERSATION</Body><Title style={styles.dark}>Speak through a fresh everyday topic.</Title><Body style={styles.darkMuted}>{starting === "conversation" ? "Starting…" : "3–5 minutes · Two voices"}</Body></Card>
        </Pressable>
        <Pressable disabled={startDisabled} onPressIn={closeOpenRow} onPress={() => void start("grammar")} accessibilityRole="button" accessibilityLabel="Start a grammar lesson" style={{ opacity: startDisabled ? 0.5 : 1 }}>
          <Card style={[styles.lessonCard, { backgroundColor: theme.mint }]}><Body style={styles.eyebrow}>GRAMMAR</Body><Title style={styles.dark}>Understand one useful pattern clearly.</Title><Body style={styles.darkMuted}>{starting === "grammar" ? "Starting…" : "8–12 minutes · One narrator"}</Body></Card>
        </Pressable>
        <Pressable onPressIn={closeOpenRow} onPress={() => router.push("/say")} accessibilityRole="button" accessibilityLabel="How would you say">
          <Card style={[styles.lessonCard, { backgroundColor: theme.coral }]}><Body style={styles.eyebrow}>HOW WOULD YOU SAY?</Body><Title style={styles.dark}>Ask for a sentence, then practice it.</Title><Body style={styles.darkMuted}>Type it · One narrator</Body></Card>
        </Pressable>
      </View>
      {lessons.length ? <View style={styles.recent}><Heading>Recent lessons</Heading>{lessons.slice(0, 3).map((lesson) => <LessonRow key={lesson.id} lesson={lesson} />)}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 7, marginBottom: 4, zIndex: 2 }, choices: { gap: 14, zIndex: 2 }, above: { zIndex: 2 }, lessonCard: { minHeight: 188, justifyContent: "space-between", borderWidth: 0 }, eyebrow: { color: "#08152F", fontSize: 12, fontWeight: "800", letterSpacing: 1.5 }, dark: { color: "#08152F", fontSize: 29, lineHeight: 34 }, darkMuted: { color: "#293652" }, recent: { gap: 10, marginTop: 8, paddingBottom: 20, zIndex: 2 }, progressTrack: { height: 8, borderRadius: 4, overflow: "hidden" }, progressFill: { height: 8, borderRadius: 4 },
});
