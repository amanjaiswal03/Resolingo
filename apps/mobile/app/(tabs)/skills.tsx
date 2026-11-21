import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import { languageById, type Lesson, type Phrase } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { usePlayback } from "@/playback/PlaybackProvider";
import { subscribeCompletedLessons } from "@/services/lessons";
import { subscribePhrases } from "@/services/phrases";
import { useSession } from "@/session/SessionProvider";
import { buildSkills, languagePairKey, progressForCard, reviewIsDue, reviewQuestions, type LanguagePair, type SkillCard, type SkillGroup, type ProgressByCard, type ReviewProgress } from "@/skills/model";
import { subscribeSkillProgress } from "@/skills/progress";
import { SkillReviewModal, type SkillSession } from "@/skills/SkillReview";
import { useExampleAudio } from "@/skills/use-example-audio";
import { useTheme } from "@/theme/tokens";

const HISTORY_PAGE_SIZE = 40;
const PAGE_EXAMPLES = 4;
const views = [
  { id: "conversation", label: "Conversation" },
  { id: "grammar", label: "Grammar" },
  { id: "phrases", label: "Saved" },
] as const;
type SkillView = (typeof views)[number]["id"];

export default function SkillsRoute() {
  const { profile, user } = useSession();
  if (!profile || !user) return <LoadingScreen />;
  return <SkillsScreen key={`${user.uid}:${languagePairKey(profile)}`} uid={user.uid} nativeLanguage={profile.nativeLanguage} targetLanguage={profile.targetLanguage} />;
}

function SkillsScreen({ uid, nativeLanguage, targetLanguage }: LanguagePair & { uid: string }) {
  const theme = useTheme();
  const router = useRouter();
  const { pause } = usePlayback();
  const audio = useExampleAudio();
  const stopAudio = audio.stop;
  const pair = useMemo(() => ({ nativeLanguage, targetLanguage }), [nativeLanguage, targetLanguage]);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [olderLessons, setOlderLessons] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [phrases, setPhrases] = useState<Phrase[] | null>(null);
  const [progress, setProgress] = useState<ProgressByCard | null>(null);
  const [error, setError] = useState<{ history?: boolean; phrases?: boolean; reviews?: boolean }>({});
  const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<SkillView | null>(null);
  const [session, setSession] = useState<SkillSession | null>(null);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [now, setNow] = useState(Date.now);

  useFocusEffect(useCallback(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearInterval(timer); stopAudio(); };
  }, [stopAudio]));

  useEffect(() => subscribeCompletedLessons(uid, historyLimit, (items, hasMore) => {
    setLessons(items);
    setOlderLessons(hasMore);
    setLoadingOlder(false);
    setError((previous) => previous.history ? { ...previous, history: false } : previous);
  }, () => {
    setError((previous) => ({ ...previous, history: true }));
    setLoadingOlder(false);
  }), [historyLimit, refresh, uid]);
  useEffect(() => subscribePhrases(uid, (items) => {
    setPhrases(items);
    setError((previous) => previous.phrases ? { ...previous, phrases: false } : previous);
  }, () => setError((previous) => ({ ...previous, phrases: true }))), [refresh, uid]);
  useEffect(() => subscribeSkillProgress(uid, pair, (items) => {
    setProgress(items);
    setError((previous) => previous.reviews ? { ...previous, reviews: false } : previous);
  }, () => setError((previous) => ({ ...previous, reviews: true }))), [pair, refresh, uid]);

  const skills = useMemo(() => buildSkills(lessons ?? [], phrases ?? [], pair), [lessons, pair, phrases]);
  const marked = useMemo(() => Object.fromEntries(skills.cards.flatMap((card) => {
    const result = progressForCard(card, progress ?? {});
    return result ? [[card.id, result] as const] : [];
  })), [progress, skills.cards]);
  const due = progress ? skills.cards.filter((card) => reviewIsDue(marked[card.id], now)).length : 0;
  const recalled = skills.cards.filter((card) => marked[card.id]?.recallRating === "got-it").length;
  const view = selected ?? (skills.conversations.length ? "conversation" : skills.grammar.length ? "grammar" : skills.phrases.length ? "phrases" : "conversation");
  const start = (title: string, pool: SkillCard[], onlyDue = false) => {
    const questions = reviewQuestions(pool, marked, pair, now, onlyDue);
    if (!questions.length) return;
    audio.stop();
    pause();
    setSession({ id: randomUUID(), title, questions });
    setReviewVisible(true);
  };

  const saved = (id: string, result: ReviewProgress) => {
    setProgress((previous) => {
      if ((previous?.[id]?.reviewedAt ?? 0) > result.reviewedAt) return previous;
      return { ...previous, [id]: result };
    });
    setNow(Date.now());
  };

  const toggleGroup = (id: string) => {
    audio.stop();
    setExpanded((current) => current === id ? null : id);
  };

  const groupRow = (group: SkillGroup, section: "grammar" | "conversation") => {
    const id = `${section}:${group.id}`;
    return (
      <SkillTile key={id} group={group} kind={section} expanded={expanded === id} onToggle={() => toggleGroup(id)}
        progress={marked} now={progress ? now : null} audio={audio}
        onPractice={(cards) => start(group.title, cards)} onSay={(phraseId) => router.push(`/say/${phraseId}`)} />
    );
  };

  if ((!lessons && !error.history) || (!phrases && !error.phrases)) return <LoadingScreen />;

  return (
    <Screen>
      <View style={styles.header}>
        <Body muted style={styles.small}>{languageById[targetLanguage].label}</Body>
        <Title>Your skills</Title>
      </View>
      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Heading>{!skills.cards.length ? "Start your skill map" : !progress ? "Practice your skills" : due ? "Review today" : "You’re caught up"}</Heading>
            <Body muted style={styles.small}>
              {!skills.cards.length ? "Finish a lesson or save a phrase in Say to start practicing."
                : !progress ? `${skills.cards.length} ${skills.cards.length === 1 ? "phrase" : "phrases"} to practice`
                : due ? `${due} ${due === 1 ? "phrase is" : "phrases are"} ready to review`
                : "You can practice again whenever you like."}
            </Body>
          </View>
          {recalled > 0 ? (
            <View style={[styles.recalled, { backgroundColor: theme.mint }]}>
              <Heading style={{ color: theme.navy }}>{recalled}</Heading>
              <Body style={[styles.small, { color: theme.navy }]}>Recalled</Body>
            </View>
          ) : null}
        </View>
        {skills.cards.length ? (
          <Button
            label={due || !progress ? "Start review" : "Practice again"}
            onPress={() => start(due ? "Today’s review" : "Skills practice", skills.cards, due > 0)}
          />
        ) : <Button label="Go to Today" onPress={() => router.navigate("/(tabs)")} />}
      </Card>
      {error.history || error.phrases || error.reviews ? (
        <Card>
          <Body muted>{error.reviews ? "Review progress couldn’t sync. You can still practice." : "Some learning history couldn’t load."}</Body>
          <Button label="Try again" variant="secondary" onPress={() => { setError({}); setRefresh((value) => value + 1); }} />
        </Card>
      ) : null}
      <View accessibilityRole="tablist" style={[styles.viewPicker, { backgroundColor: theme.surfaceMuted }]}>
        {views.map(({ id, label }) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: view === id }}
            onPress={() => { stopAudio(); setExpanded(null); setSelected(id); }}
            style={[styles.viewButton, view === id && { backgroundColor: theme.surface }]}>
            <Body muted={view !== id} style={styles.viewLabel}>{label}</Body>
          </Pressable>
        ))}
      </View>
      <View style={styles.section}>
        {view === "conversation" ? (
          <>
            <Heading accessibilityRole="header">What you can practice saying</Heading>
            {skills.conversations.length ? skills.conversations.map((group) => groupRow(group, "conversation"))
              : <Body muted>Finish a conversation lesson to collect phrases by what they help you do.</Body>}
          </>
        ) : view === "grammar" ? (
          <>
            <Heading accessibilityRole="header">How to build your sentences</Heading>
            {skills.grammar.length ? skills.grammar.map((group) => groupRow(group, "grammar"))
              : <Body muted>Patterns appear here after you finish a grammar lesson.</Body>}
          </>
        ) : (
          <>
            <Heading accessibilityRole="header">My phrases</Heading>
            {skills.phrases.length ? (
              <SkillTile group={{ id: "say", title: "Saved in Say", cards: skills.phrases }} kind="phrases" expanded={expanded === "say"}
                onToggle={() => toggleGroup("say")} progress={marked} now={progress ? now : null} audio={audio}
                onPractice={(cards) => start("My phrases", cards)} onSay={(id) => router.push(`/say/${id}`)} />
            ) : <Button label="Look up a phrase in Say" variant="secondary" onPress={() => router.push("/say")} />}
          </>
        )}
      </View>
      {olderLessons && view !== "phrases" ? (
        <Button label="Show earlier lessons" variant="secondary" loading={loadingOlder}
          onPress={() => { setLoadingOlder(true); setHistoryLimit((count) => count + HISTORY_PAGE_SIZE); }} />
      ) : null}
      <SkillReviewModal visible={reviewVisible} session={session} uid={uid} pair={pair}
        onClose={() => setReviewVisible(false)} onSaved={saved} />
    </Screen>
  );
}

function SkillTile({ group, kind, expanded, onToggle, progress, now, audio, onPractice, onSay }: {
  group: SkillGroup;
  kind: "grammar" | "conversation" | "phrases";
  expanded: boolean;
  onToggle: () => void;
  progress: ProgressByCard;
  now: number | null;
  audio: ReturnType<typeof useExampleAudio>;
  onPractice: (cards: SkillCard[]) => void;
  onSay: (id: string) => void;
}) {
  const theme = useTheme();
  const [visibleCount, setVisibleCount] = useState(PAGE_EXAMPLES);
  const color = kind === "grammar" ? theme.mint : kind === "conversation" ? theme.amber : theme.coral;
  const count = group.cards.length;
  const practiceCards = group.reviewCards ?? group.cards;
  const due = now === null ? 0 : practiceCards.filter((card) => reviewIsDue(progress[card.id], now)).length;
  const shared = practiceCards.length - count;
  const patterns = group.patterns?.length ?? 0;
  const details = [
    ...(patterns ? [`${patterns} ${patterns === 1 ? "pattern" : "patterns"}`] : []),
    ...(count ? [`${count} ${count === 1 ? "phrase" : "phrases"}`] : []),
    ...(shared ? [`${shared} shared`] : []),
    ...(due ? [`${due} to review`] : []),
  ].join(" · ");

  return (
    <View style={kind === "grammar" ? [styles.grammarBranch, { borderColor: theme.border }] : undefined}>
      <Card style={styles.tile}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle} style={styles.tileButton}>
          <View style={[styles.tileIcon, { backgroundColor: color }]}><Body style={{ color: theme.navy }}>{kind === "grammar" ? "◇" : kind === "conversation" ? "◫" : "✦"}</Body></View>
          <View style={styles.tileCopy}>
            <Heading style={styles.tileHeading}>{group.title}</Heading>
            <Body muted style={styles.small}>{details}</Body>
          </View>
          <Body muted>{expanded ? "−" : "+"}</Body>
        </Pressable>
        {expanded ? (
          <View style={[styles.expanded, { borderColor: theme.border }]}>
            {group.patterns?.map((pattern) => (
              <View key={pattern.id} style={styles.pattern}>
                <Heading style={styles.tileHeading}>{pattern.title}</Heading>
                {pattern.description ? <Body muted style={styles.small}>{pattern.description}</Body> : null}
              </View>
            ))}
            {practiceCards.length ? <Button label={kind === "phrases" ? "Review my phrases" : "Practice this skill"} variant="secondary" onPress={() => onPractice(practiceCards)} /> : null}
            {group.cards.slice(0, visibleCount).map((card) => {
              const result = progress[card.id];
              return (
                <View key={card.id} style={[styles.example, { backgroundColor: theme.surfaceMuted }]}>
                  <Heading style={styles.tileHeading}>{card.target}</Heading>
                  <Body muted style={styles.small}>{card.meaning}</Body>
                  {card.otherMeanings?.length ? <Body muted style={styles.small}>Also translated as {card.otherMeanings.join(" / ")}</Body> : null}
                  {card.practicedAt ? <Body muted style={styles.small}>{(card.lessonCount ?? 1) > 1 ? `Practiced in ${card.lessonCount} lessons` : "Practiced in a lesson"}</Body> : null}
                  {result?.recallRating === "got-it" ? <Body style={styles.small}>Recalled in review</Body>
                    : result?.recallRating ? <Body style={styles.small}>Try again in review</Body>
                    : result?.lastMode === "recognition" && result.lastRating === "got-it" ? <Body style={styles.small}>Recognized in review</Body> : null}
                  {card.audioPath || kind === "phrases" ? (
                    <View style={styles.exampleActions}>
                      {card.audioPath ? <Pressable accessibilityRole="button" style={styles.inlineButton} onPress={() => card.audioPath && void audio.play(card.audioPath)}>
                        <Body style={[styles.small, { color: theme.primary }]}>{audio.label(card.audioPath)}</Body>
                      </Pressable> : null}
                      {kind === "phrases" && card.phraseId ? <Pressable accessibilityRole="button" style={styles.inlineButton} onPress={() => { audio.stop(); if (card.phraseId) onSay(card.phraseId); }}>
                        <Body style={[styles.small, { color: theme.primary }]}>Open in Say</Body>
                      </Pressable> : null}
                      {kind === "phrases" ? <Pressable accessibilityRole="button" style={styles.inlineButton} onPress={() => onPractice([card])}>
                        <Body style={[styles.small, { color: theme.primary }]}>Practice phrase</Body>
                      </Pressable> : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {count > visibleCount ? <Button label="Show more phrases" variant="ghost" onPress={() => setVisibleCount((value) => value + PAGE_EXAMPLES)} /> : null}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 3 },
  small: { fontSize: 13, lineHeight: 19 },
  hero: { gap: 14 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 13 },
  heroCopy: { flex: 1, gap: 4 },
  recalled: { minWidth: 75, borderRadius: 15, paddingHorizontal: 8, paddingVertical: 6, alignItems: "center" },
  viewPicker: { flexDirection: "row", padding: 4, gap: 4, borderRadius: 14 },
  viewButton: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 11, paddingHorizontal: 3 },
  viewLabel: { fontSize: 13, lineHeight: 19, fontWeight: "700", textAlign: "center" },
  section: { gap: 9, marginTop: 7 },
  grammarBranch: { paddingLeft: 11, borderLeftWidth: 2, marginLeft: 5 },
  tile: { padding: 0, gap: 0, overflow: "hidden" },
  tileButton: { flexDirection: "row", alignItems: "center", padding: 13, gap: 11, minHeight: 66 },
  tileIcon: { minWidth: 39, minHeight: 39, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingHorizontal: 4 },
  tileCopy: { flex: 1 },
  tileHeading: { fontSize: 17, lineHeight: 23 },
  expanded: { borderTopWidth: StyleSheet.hairlineWidth, padding: 13, gap: 10 },
  pattern: { gap: 3 },
  example: { padding: 11, borderRadius: 12, gap: 2 },
  exampleActions: { flexDirection: "row", flexWrap: "wrap", columnGap: 15 },
  inlineButton: { minHeight: 44, justifyContent: "center" },
});
