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
import { dailyCapBlocksStart, dailyQuotaLabel } from "@/home/daily-quota";
import { useLessons } from "@/hooks/useLessons";
import { percentWidth } from "@/lesson/navigation";
import { api } from "@/services/api";
import { listenForPushTokenChanges, registerForPush } from "@/services/notifications";
import { report, track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

function dateInZone(zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default function HomeScreen() {
  const { profile } = useSession();
  const { lessons, loading } = useLessons();
  const router = useRouter();
  const theme = useTheme();
  const [starting, setStarting] = useState<LessonType | null>(null);
  useEffect(() => {
    if (!profile?.reminderEnabled) return;
    void registerForPush();
    const subscription = listenForPushTokenChanges();
    return () => subscription.remove();
  }, [profile?.reminderEnabled]);
  const today = profile ? dateInZone(profile.timezone) : "";
  const used = useMemo(() => lessons.filter((lesson) => lesson.quotaDate === today && lesson.status === "ready").length, [lessons, today]);
  const unlimited = profile?.unlimitedLessons === true;
  const active = lessons.find((lesson) => ["queued", "generating_content", "synthesizing_audio"].includes(lesson.status));
  const startDisabled = Boolean(starting || active) || dailyCapBlocksStart(used, unlimited);
  const start = async (type: LessonType) => {
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
    <Screen>
      <View style={styles.header}><Body muted>GOOD TO SEE YOU, {profile.nickname.toUpperCase()}</Body><Title>What will you practice?</Title><Body muted>{dailyQuotaLabel(used, unlimited)}</Body></View>
      {active ? <Pressable onPress={() => router.push(`/lesson/${active.id}`)}><Card style={{ backgroundColor: theme.surfaceMuted }}><Body muted>IN PROGRESS</Body><Heading>{active.title}</Heading><View style={[styles.progressTrack, { backgroundColor: theme.border }]}><View style={[styles.progressFill, { backgroundColor: theme.primary, width: percentWidth(active.progress) }]} /></View><Body muted>{Number.isFinite(active.progress) ? active.progress : 0}% · Tap to follow progress</Body></Card></Pressable> : null}
      <View style={styles.choices}>
        <Pressable disabled={startDisabled} onPress={() => void start("conversation")} accessibilityRole="button" accessibilityLabel="Start a conversation lesson" style={{ opacity: startDisabled ? 0.5 : 1 }}>
          <Card style={[styles.lessonCard, { backgroundColor: theme.amber }]}><Body style={styles.eyebrow}>CONVERSATION</Body><Title style={styles.dark}>Speak through a fresh everyday topic.</Title><Body style={styles.darkMuted}>{starting === "conversation" ? "Starting…" : "3–5 minutes · Two voices"}</Body></Card>
        </Pressable>
        <Pressable disabled={startDisabled} onPress={() => void start("grammar")} accessibilityRole="button" accessibilityLabel="Start a grammar lesson" style={{ opacity: startDisabled ? 0.5 : 1 }}>
          <Card style={[styles.lessonCard, { backgroundColor: theme.mint }]}><Body style={styles.eyebrow}>GRAMMAR</Body><Title style={styles.dark}>Understand one useful pattern clearly.</Title><Body style={styles.darkMuted}>{starting === "grammar" ? "Starting…" : "3–5 minutes · Guided examples"}</Body></Card>
        </Pressable>
      </View>
      {lessons.length ? <View style={styles.recent}><Heading>Recent lessons</Heading>{lessons.slice(0, 3).map((lesson) => <LessonRow key={lesson.id} lesson={lesson} />)}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 7, marginBottom: 4 }, choices: { gap: 14 }, lessonCard: { minHeight: 188, justifyContent: "space-between", borderWidth: 0 }, eyebrow: { color: "#08152F", fontSize: 12, fontWeight: "800", letterSpacing: 1.5 }, dark: { color: "#08152F", fontSize: 29, lineHeight: 34 }, darkMuted: { color: "#293652" }, recent: { gap: 10, marginTop: 8, paddingBottom: 20 }, progressTrack: { height: 8, borderRadius: 4, overflow: "hidden" }, progressFill: { height: 8, borderRadius: 4 },
});
