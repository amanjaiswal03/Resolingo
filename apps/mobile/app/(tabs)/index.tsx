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
import { LessonOfTheDayCard, LessonOfTheDayPlaceholder } from "@/home/LessonOfTheDayCard";
import { countsTowardCap, pickCardState } from "@/home/lesson-of-the-day";
import { useLessonOfTheDay } from "@/home/use-lesson-of-the-day";
import { HOW_WOULD_YOU_SAY_ENABLED, showHowWouldYouSayLesson } from "@/features";
import { dailyCapBlocksStart, dailyQuotaLabel, lessonsReadyToday } from "@/home/daily-quota";
import { LessonRowDismiss, useLessonList } from "@/lessons/delete-lesson";
import { percentWidth } from "@/lesson/navigation";
import { usePlayback } from "@/playback/PlaybackProvider";
import { api } from "@/services/api";
import { subscribeReadyCount } from "@/services/lessons";
import { listenForPushTokenChanges, registerForPush } from "@/services/notifications";
import { report, track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

type DailyLessonType = Exclude<LessonType, "phrase">;

const kindLabel = { conversation: "Conversation", grammar: "Grammar", phrase: "Phrase" } as const;

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
  const { open, openedLessonIds, openedLessonsReady } = usePlayback();
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
    lessons.filter((lesson) => lesson.quotaDate === today && lesson.status === "ready" && countsTowardCap(lesson)).length,
    heldReadyDates.filter((date) => date === today).length,
    recordedReady,
  ), [heldReadyDates, lessons, recordedReady, today]);
  const unlimited = profile?.unlimitedLessons === true;
  const daily = useLessonOfTheDay(today, Boolean(profile?.onboardingComplete));
  const pick = daily.pick;
  const capReached = dailyCapBlocksStart(used, unlimited);
  const pickState = pick ? pickCardState({ pick, lessons, capReached }) : undefined;
  const visible = useMemo(() => lessons.filter((lesson) => showHowWouldYouSayLesson(lesson.type)), [lessons]);
  const active = visible.find((lesson) => ["queued", "generating_content", "synthesizing_audio"].includes(lesson.status));
  // The lesson of the day card already shows its own lesson, so it is not repeated below it.
  const finished = useMemo(() => openedLessonsReady ? visible
    .filter((lesson) => lesson.status === "ready" && lesson.quotaDate === today && !openedLessonIds.has(lesson.id) && lesson.id !== pick?.lessonId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined, [openedLessonIds, openedLessonsReady, pick?.lessonId, today, visible]);
  const recent = visible.filter((lesson) => lesson.status === "ready" && lesson.id !== finished?.id).slice(0, 3);
  const startDisabled = Boolean(starting || active) || capReached;
  const [startingPick, setStartingPick] = useState(false);
  const openPick = () => {
    if (!pick || !pickState || startingPick) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (pickState.kind === "ready" || pickState.kind === "done") {
      open(pickState.lesson.id, { expand: true });
      return;
    }
    if (pickState.kind === "preparing" && pick.lessonId) {
      router.push(`/lesson/${pick.lessonId}`);
      return;
    }
    if (pickState.kind !== "planned") return;
    if (active) {
      Alert.alert("One lesson at a time", "Another lesson is being written. Today's lesson can start as soon as it's ready.");
      return;
    }
    const lessonId = Crypto.randomUUID();
    setStartingPick(true);
    daily.markStarted(lessonId);
    router.push(`/lesson/${lessonId}`);
    void (async () => {
      try {
        const result = await api.createDailyLesson(pick.type, lessonId, { lessonOfTheDay: true });
        if (result.lessonId !== lessonId) {
          daily.markStarted(result.lessonId);
          router.replace(`/lesson/${result.lessonId}`);
        }
        if (profile?.telemetryConsent) await track("lesson_requested", { type: pick.type, source: pick.kind === "welcome" ? "welcome" : "lesson_of_the_day" });
      } catch (error) {
        report(error);
        void daily.refresh();
        Alert.alert("Couldn’t start today’s lesson", error instanceof Error ? error.message : "Please try again.");
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)");
      } finally { setStartingPick(false); }
    })();
  };
  const start = (type: DailyLessonType) => {
    if (startDisabled) return;
    const lessonId = Crypto.randomUUID();
    setStarting(type);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/lesson/${lessonId}`);
    void (async () => {
      try {
        await api.createDailyLesson(type, lessonId);
        if (profile?.telemetryConsent) await track("lesson_requested", { type });
      } catch (error) {
        report(error);
        Alert.alert("Couldn’t start a lesson", error instanceof Error ? error.message : "Please try again.");
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)");
      } finally { setStarting(null); }
    })();
  };
  if (loading || !profile) return <LoadingScreen />;
  return (
    <Screen onScrollBeginDrag={closeOpenRow}>
      <LessonRowDismiss />
      <View style={styles.header} onTouchStart={closeOpenRow}><Body muted>GOOD TO SEE YOU, {profile.nickname.toUpperCase()}</Body><Title>What will you practice?</Title><Body muted>{dailyQuotaLabel(used, unlimited)}</Body></View>
      {pick && pickState ? (
        <LessonOfTheDayCard
          pick={pick}
          state={pickState}
          nativeLanguage={profile.nativeLanguage}
          targetLanguage={profile.targetLanguage}
          onPress={openPick}
          onPressIn={closeOpenRow}
        />
      ) : daily.loading ? <LessonOfTheDayPlaceholder /> : null}
      {finished ? <Pressable onPressIn={closeOpenRow} onPress={() => open(finished.id, { expand: true })} accessibilityRole="button" accessibilityLabel={`${finished.title}, ready to play`} style={styles.above}><Card style={[styles.statusCard, styles.highlight, { borderColor: theme.brand, backgroundColor: theme.primaryTint }]}><Body style={[styles.ready, { color: theme.primary }]}>READY</Body><Heading style={styles.statusTitle}>{finished.title}</Heading><Body muted style={styles.statusMeta}>{kindLabel[finished.type]} · Tap to play</Body></Card></Pressable> : null}
      {active && active.id !== pick?.lessonId ? <Pressable onPressIn={closeOpenRow} onPress={() => router.push(`/lesson/${active.id}`)} style={styles.above}><Card style={[styles.statusCard, { backgroundColor: theme.surfaceMuted }]}><Body muted style={styles.statusMeta}>IN PROGRESS</Body><Heading style={styles.statusTitle}>{active.title}</Heading><View style={[styles.progressTrack, { backgroundColor: theme.border }]}><View style={[styles.progressFill, { backgroundColor: theme.brand, width: percentWidth(active.progress) }]} /></View><Body muted style={styles.statusMeta}>{Number.isFinite(active.progress) ? active.progress : 0}% · Tap to follow progress</Body></Card></Pressable> : null}
      {pick ? <Body muted style={styles.section} onPress={closeOpenRow}>OR CHOOSE YOUR OWN</Body> : null}
      <View style={styles.choices}>
        <Pressable disabled={startDisabled} onPressIn={closeOpenRow} onPress={() => void start("conversation")} accessibilityRole="button" accessibilityLabel="Start a conversation lesson" style={{ opacity: startDisabled ? 0.5 : 1 }}>
          <Card style={[styles.lessonCard, { backgroundColor: theme.amber }]}><Body style={styles.eyebrow}>CONVERSATION</Body><Title style={styles.dark}>Speak through a fresh everyday topic.</Title><Body style={styles.darkMuted}>{starting === "conversation" ? "Starting…" : "5–8 minutes · Two voices"}</Body></Card>
        </Pressable>
        <Pressable disabled={startDisabled} onPressIn={closeOpenRow} onPress={() => void start("grammar")} accessibilityRole="button" accessibilityLabel="Start a grammar lesson" style={{ opacity: startDisabled ? 0.5 : 1 }}>
          <Card style={[styles.lessonCard, { backgroundColor: theme.mint }]}><Body style={styles.eyebrow}>GRAMMAR</Body><Title style={styles.dark}>Understand one useful pattern clearly.</Title><Body style={styles.darkMuted}>{starting === "grammar" ? "Starting…" : "5–8 minutes · One narrator"}</Body></Card>
        </Pressable>
        {HOW_WOULD_YOU_SAY_ENABLED ? (
          <Pressable onPressIn={closeOpenRow} onPress={() => router.push("/say")} accessibilityRole="button" accessibilityLabel="How would you say">
            <Card style={[styles.lessonCard, { backgroundColor: theme.coral }]}><Body style={styles.eyebrow}>HOW WOULD YOU SAY?</Body><Title style={styles.dark}>Ask for a sentence, then practice it.</Title><Body style={styles.darkMuted}>Type it · One narrator</Body></Card>
          </Pressable>
        ) : null}
      </View>
      {recent.length ? <View style={styles.recent}><Heading>Recent lessons</Heading>{recent.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} />)}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 7, marginBottom: 4, zIndex: 2 }, choices: { gap: 14, zIndex: 2 }, above: { zIndex: 2 }, statusCard: { paddingVertical: 12, paddingHorizontal: 14, gap: 4 }, highlight: { borderWidth: 2 }, ready: { fontSize: 12, lineHeight: 16, fontWeight: "800", letterSpacing: 1.4 }, statusTitle: { fontSize: 17, lineHeight: 22 }, statusMeta: { fontSize: 14, lineHeight: 18 }, lessonCard: { minHeight: 188, justifyContent: "space-between", borderWidth: 0 }, eyebrow: { color: "#08152F", fontSize: 12, fontWeight: "800", letterSpacing: 1.5 }, dark: { color: "#08152F", fontSize: 29, lineHeight: 34 }, darkMuted: { color: "#293652" }, recent: { gap: 8, marginTop: 8, paddingBottom: 20, zIndex: 2 }, progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" }, progressFill: { height: 6, borderRadius: 3 }, section: { fontSize: 12, lineHeight: 16, fontWeight: "800", letterSpacing: 1.4, marginTop: 4, marginBottom: -6, zIndex: 2 },
});
