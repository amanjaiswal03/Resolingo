import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import type { LessonType } from "@resolingo/shared";
import { LessonArtwork } from "@/components/LessonArtwork";
import { LessonRow } from "@/components/LessonRow";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PlayGlyph } from "@/components/PlayGlyph";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { LessonOfTheDayCard, LessonOfTheDayPlaceholder } from "@/home/LessonOfTheDayCard";
import { countsTowardCap, pickCardState, showPickCard } from "@/home/lesson-of-the-day";
import { useLessonOfTheDay } from "@/home/use-lesson-of-the-day";
import { HOW_WOULD_YOU_SAY_ENABLED, showHowWouldYouSayLesson } from "@/features";
import { DAILY_LESSON_CAP, dailyCapBlocksStart, dailyQuotaLabel, lessonsReadyToday } from "@/home/daily-quota";
import { greetingFor, hourInZone } from "@/home/greeting";
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
  const showPick = Boolean(pickState && showPickCard(pickState));
  const visible = useMemo(() => lessons.filter((lesson) => showHowWouldYouSayLesson(lesson.type)), [lessons]);
  const active = visible.find((lesson) => ["queued", "generating_content", "synthesizing_audio"].includes(lesson.status));
  const finished = useMemo(() => openedLessonsReady ? visible
    .filter((lesson) => lesson.status === "ready" && lesson.quotaDate === today && !openedLessonIds.has(lesson.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined, [openedLessonIds, openedLessonsReady, today, visible]);
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
  const greeting = greetingFor(hourInZone(profile.timezone));
  return (
    <Screen onScrollBeginDrag={closeOpenRow} style={styles.content}>
      <LessonRowDismiss />
      <View style={styles.header} onTouchStart={closeOpenRow}>
        <Body muted style={styles.greeting}>{greeting}, {profile.nickname}</Body>
        <Title>What will you practice?</Title>
        <QuotaMeter used={used} unlimited={unlimited} />
      </View>
      {showPick && pick && pickState ? (
        <LessonOfTheDayCard
          pick={pick}
          state={pickState}
          nativeLanguage={profile.nativeLanguage}
          targetLanguage={profile.targetLanguage}
          onPress={openPick}
          onPressIn={closeOpenRow}
        />
      ) : daily.loading ? <LessonOfTheDayPlaceholder /> : null}
      {finished ? (
        <Pressable onPressIn={closeOpenRow} onPress={() => open(finished.id, { expand: true })} accessibilityRole="button" accessibilityLabel={`${finished.title}, ready to play`} style={({ pressed }) => [styles.above, pressed ? styles.pressed : null]}>
          <View style={[styles.statusCard, { borderColor: theme.brand, backgroundColor: theme.primaryTint }]}>
            <LessonArtwork lesson={finished} size={52} radius={14} />
            <View style={styles.statusCopy}>
              <Text style={[styles.statusEyebrow, { color: theme.primary }]}>READY TO PLAY</Text>
              <Heading numberOfLines={2} style={styles.statusTitle}>{finished.title}</Heading>
              <Body muted style={styles.statusMeta}>{kindLabel[finished.type]}</Body>
            </View>
            <View style={[styles.statusPlay, { backgroundColor: theme.primaryFill }]}><PlayGlyph playing={false} color={theme.onPrimary} size={16} /></View>
          </View>
        </Pressable>
      ) : null}
      {active ? (
        <Pressable onPressIn={closeOpenRow} onPress={() => router.push(`/lesson/${active.id}`)} style={({ pressed }) => [styles.above, pressed ? styles.pressed : null]}>
          <View style={[styles.statusCard, styles.statusColumn, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <Text style={[styles.statusEyebrow, { color: theme.textMuted }]}>WRITING YOUR LESSON</Text>
            <Heading numberOfLines={2} style={styles.statusTitle}>{active.title}</Heading>
            <View style={[styles.progressTrack, { backgroundColor: theme.surfaceMuted }]}><View style={[styles.progressFill, { backgroundColor: theme.brand, width: percentWidth(active.progress) }]} /></View>
            <Body muted style={styles.statusMeta}>{Number.isFinite(active.progress) ? active.progress : 0}% · Tap to follow progress</Body>
          </View>
        </Pressable>
      ) : null}
      <View style={styles.sectionBlock}>
        <Text accessibilityRole="header" style={[styles.section, { color: theme.textMuted }]} onPress={closeOpenRow}>{showPick ? "OR CHOOSE YOUR OWN" : "START A LESSON"}</Text>
        <View style={styles.choices}>
          <ChoiceTile
            color={theme.amber}
            mark="💬"
            label="Conversation"
            line="Speak through a fresh everyday scene."
            meta={starting === "conversation" ? "Starting…" : "5–8 min · Two voices"}
            disabled={startDisabled}
            onPressIn={closeOpenRow}
            onPress={() => void start("conversation")}
            accessibilityLabel="Start a conversation lesson"
          />
          <ChoiceTile
            color={theme.mint}
            mark="🧩"
            label="Grammar"
            line="Understand one useful pattern clearly."
            meta={starting === "grammar" ? "Starting…" : "5–8 min · One narrator"}
            disabled={startDisabled}
            onPressIn={closeOpenRow}
            onPress={() => void start("grammar")}
            accessibilityLabel="Start a grammar lesson"
          />
        </View>
        {HOW_WOULD_YOU_SAY_ENABLED ? (
          <Pressable onPressIn={closeOpenRow} onPress={() => router.push("/say")} accessibilityRole="button" accessibilityLabel="How would you say" style={({ pressed }) => [styles.above, pressed ? styles.pressed : null]}>
            <View style={[styles.sayCard, { backgroundColor: theme.coral }]}>
              <Text style={styles.choiceMark}>🗣️</Text>
              <View style={styles.statusCopy}>
                <Text style={styles.choiceLabel}>How would you say…?</Text>
                <Text style={styles.choiceLine}>Ask for a sentence, then practice it.</Text>
              </View>
            </View>
          </Pressable>
        ) : null}
      </View>
      {recent.length ? (
        <View style={styles.recent}>
          <View style={styles.recentHeader}>
            <Text accessibilityRole="header" style={[styles.section, { color: theme.textMuted }]}>RECENT LESSONS</Text>
            <Pressable accessibilityRole="link" accessibilityLabel="See all lessons" onPress={() => router.navigate("/(tabs)/history")} hitSlop={10}>
              <Text style={[styles.seeAll, { color: theme.primary }]}>See all</Text>
            </Pressable>
          </View>
          {recent.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} />)}
        </View>
      ) : null}
    </Screen>
  );
}

/** Three small pills, one per daily lesson, so the cap reads at a glance. */
function QuotaMeter({ used, unlimited }: { used: number; unlimited: boolean }) {
  const theme = useTheme();
  if (unlimited) return <Body muted style={styles.quotaText}>Unlimited lessons</Body>;
  const left = Math.max(0, DAILY_LESSON_CAP - used);
  return (
    <View accessible accessibilityLabel={dailyQuotaLabel(used, unlimited)} style={styles.quota}>
      <View style={styles.quotaPills}>
        {Array.from({ length: DAILY_LESSON_CAP }, (_, index) => (
          <View key={index} style={[styles.quotaPill, { backgroundColor: index < used ? theme.brand : theme.surfaceMuted, borderColor: index < used ? theme.brand : theme.border }]} />
        ))}
      </View>
      <Body muted style={styles.quotaText}>{left === 0 ? "You’ve used all 3 lessons today" : `${left} of ${DAILY_LESSON_CAP} lessons left today`}</Body>
    </View>
  );
}

function ChoiceTile({ color, mark, label, line, meta, disabled, onPress, onPressIn, accessibilityLabel }: {
  color: string;
  mark: string;
  label: string;
  line: string;
  meta: string;
  disabled: boolean;
  onPress: () => void;
  onPressIn: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPressIn={onPressIn}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.choice, { backgroundColor: color, opacity: disabled ? 0.5 : 1 }, pressed && !disabled ? styles.pressed : null]}
    >
      <View style={styles.choiceBadge}><Text style={styles.choiceMark}>{mark}</Text></View>
      <View style={styles.choiceCopy}>
        <Text style={styles.choiceLabel} maxFontSizeMultiplier={1.4}>{label}</Text>
        <Text style={styles.choiceLine} maxFontSizeMultiplier={1.5}>{line}</Text>
      </View>
      <Text style={styles.choiceMeta} maxFontSizeMultiplier={1.5}>{meta}</Text>
    </Pressable>
  );
}

const INK = "#08152F";

const styles = StyleSheet.create({
  content: { gap: 20 },
  header: { gap: 6, zIndex: 2 },
  greeting: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  quota: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  quotaPills: { flexDirection: "row", gap: 4 },
  quotaPill: { width: 18, height: 6, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth },
  quotaText: { fontSize: 14, lineHeight: 19 },
  above: { zIndex: 2 },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.94 },
  statusCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 22, borderWidth: 1.5, padding: 12 },
  statusColumn: { flexDirection: "column", alignItems: "stretch", gap: 6, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 14 },
  statusCopy: { flex: 1, gap: 2 },
  statusEyebrow: { fontSize: 11, lineHeight: 15, fontWeight: "800", letterSpacing: 1.2 },
  statusTitle: { fontSize: 17, lineHeight: 22 },
  statusMeta: { fontSize: 14, lineHeight: 18 },
  statusPlay: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginTop: 4 },
  progressFill: { height: 6, borderRadius: 3 },
  sectionBlock: { gap: 10, zIndex: 2 },
  section: { fontSize: 12, lineHeight: 16, fontWeight: "800", letterSpacing: 1.2 },
  choices: { flexDirection: "row", gap: 12 },
  choice: { flex: 1, minHeight: 176, borderRadius: 24, padding: 16, gap: 10, justifyContent: "space-between" },
  choiceBadge: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.55)", alignItems: "center", justifyContent: "center" },
  choiceMark: { fontSize: 20, lineHeight: 26 },
  choiceCopy: { gap: 4 },
  choiceLabel: { color: INK, fontSize: 19, lineHeight: 24, fontWeight: "800", letterSpacing: -0.2 },
  choiceLine: { color: "#293652", fontSize: 14, lineHeight: 19 },
  choiceMeta: { color: "#293652", fontSize: 12, lineHeight: 16, fontWeight: "700" },
  sayCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 22, padding: 16 },
  recent: { gap: 10, paddingBottom: 20, zIndex: 2 },
  recentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  seeAll: { fontSize: 14, fontWeight: "700" },
});
