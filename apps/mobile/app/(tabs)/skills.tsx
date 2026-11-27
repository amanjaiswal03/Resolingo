import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { languageById, type Lesson, type Phrase } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { SkillsSkeleton } from "@/components/Skeleton";
import { MicGlyph } from "@/components/MicGlyph";
import { PressableScale } from "@/components/PressableScale";
import { ProgressRing } from "@/components/ProgressRing";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { HOW_WOULD_YOU_SAY_ENABLED } from "@/features";
import { languageFlag } from "@/languages/flags";
import { usePlayback } from "@/playback/PlaybackProvider";
import { subscribeCompletedLessons } from "@/services/lessons";
import { subscribePhrases } from "@/services/phrases";
import { useSession } from "@/session/SessionProvider";
import { levelColor, levelInk, levelName } from "@/skills/levels";
import {
  buildSkills, languagePairKey, masteryLevel, phraseFamilies, progressForCard, reviewDaysThisWeek, reviewIsDue, reviewQuestions, skillMastery,
  WEEKLY_GOAL_DAYS, type LanguagePair, type MasteryLevel, type ProgressByCard, type ReviewProgress, type SkillCard, type SkillGroup,
} from "@/skills/model";
import { subscribeSkillProgress } from "@/skills/progress";
import { SkillReviewModal, type SkillSession } from "@/skills/SkillReview";
import { AudioGlyph } from "@/skills/AudioGlyph";
import { useExampleAudio } from "@/skills/use-example-audio";
import { useTheme } from "@/theme/tokens";

const HISTORY_PAGE_SIZE = 40;
const PAGE_EXAMPLES = 8;
const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const views = [
  { id: "conversation", label: "Conversation" },
  { id: "grammar", label: "Grammar" },
  { id: "phrases", label: "Saved" },
] as const;
type SkillView = (typeof views)[number]["id"];
type OpenSkill = { group: SkillGroup; kind: "grammar" | "conversation" | "phrases" };
const shownViews = views.filter((item) => HOW_WOULD_YOU_SAY_ENABLED || item.id !== "phrases");

export default function SkillsRoute() {
  const { profile, user, error, retry } = useSession();
  if (!profile && error) return <Screen><ErrorState onRetry={retry} /></Screen>;
  if (!profile || !user) return <SkillsSkeleton />;
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
  const [selected, setSelected] = useState<SkillView | null>(null);
  const [open, setOpen] = useState<OpenSkill | null>(null);
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

  const skills = useMemo(
    () => buildSkills(lessons ?? [], HOW_WOULD_YOU_SAY_ENABLED ? (phrases ?? []) : [], pair),
    [lessons, pair, phrases],
  );
  const families = useMemo(() => phraseFamilies(skills.cards, pair), [pair, skills.cards]);
  const marked = useMemo(() => Object.fromEntries(skills.cards.flatMap((card) => {
    const result = progressForCard(card, progress ?? {});
    return result ? [[card.id, result] as const] : [];
  })), [progress, skills.cards]);
  const overall = useMemo(() => skillMastery(skills.cards, marked), [marked, skills.cards]);
  const week = useMemo(() => reviewDaysThisWeek(progress ?? {}, now), [now, progress]);
  const due = progress ? skills.cards.filter((card) => reviewIsDue(marked[card.id], now)).length : 0;
  const view = selected && shownViews.some((item) => item.id === selected)
    ? selected
    : skills.conversations.length ? "conversation"
    : skills.grammar.length ? "grammar"
    : HOW_WOULD_YOU_SAY_ENABLED && skills.phrases.length ? "phrases"
    : "conversation";

  const start = (title: string, pool: SkillCard[], onlyDue = false) => {
    const questions = reviewQuestions(pool, marked, pair, now, onlyDue, families);
    if (!questions.length) return;
    audio.stop();
    pause();
    setOpen(null);
    setSession({ id: randomUUID(), title, questions, before: marked });
    setReviewVisible(true);
  };

  const saved = (id: string, result: ReviewProgress) => {
    setProgress((previous) => {
      if ((previous?.[id]?.reviewedAt ?? 0) > result.reviewedAt) return previous;
      return { ...previous, [id]: result };
    });
    setNow(Date.now());
  };

  const retryAll = () => { setError({}); setRefresh((value) => value + 1); };
  if ((!lessons && !error.history) || (HOW_WOULD_YOU_SAY_ENABLED && !phrases && !error.phrases)) return <SkillsSkeleton />;
  if (!lessons && (!HOW_WOULD_YOU_SAY_ENABLED || !phrases)) {
    return <Screen><ErrorState title="Couldn’t load your skills" message="Check your connection and try again." onRetry={retryAll} /></Screen>;
  }

  const groups = view === "conversation" ? skills.conversations : view === "grammar" ? skills.grammar
    : skills.phrases.length ? [{ id: "say", title: "Saved in Say", cards: skills.phrases }] : [];
  const kind = view === "phrases" ? "phrases" : view;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Title>Skills</Title>
          <View style={styles.languageRow}>
            <Text style={styles.flag}>{languageFlag(targetLanguage)}</Text>
            <Body muted style={styles.languageLabel}>{languageById[targetLanguage].label}</Body>
          </View>
        </View>
        {skills.cards.length ? (
          <View style={[styles.countChip, { backgroundColor: theme.surfaceMuted }]}>
            <Body style={styles.countLabel}>{skills.cards.length} {skills.cards.length === 1 ? "phrase" : "phrases"}</Body>
          </View>
        ) : null}
      </View>

      <WeekCard week={week} due={due} hasCards={skills.cards.length > 0} synced={progress !== null}
        onStart={() => start(due ? "Today’s review" : "Skills practice", skills.cards, due > 0)}
        onToday={() => router.navigate("/(tabs)")} />

      {error.history || (HOW_WOULD_YOU_SAY_ENABLED && error.phrases) || error.reviews ? (
        <Card>
          <Body muted>{error.reviews ? "Review progress couldn’t sync. You can still practice." : "Some learning history couldn’t load."}</Body>
          <Button label="Try again" variant="secondary" onPress={retryAll} />
        </Card>
      ) : null}

      {skills.cards.length ? <StrengthCard counts={overall.counts} /> : null}

      <View accessibilityRole="tablist" style={[styles.viewPicker, { backgroundColor: theme.surfaceMuted }]}>
        {shownViews.map(({ id, label }) => (
          <PressableScale haptic="selection" scaleTo={0.96} key={id} accessibilityRole="tab" accessibilityState={{ selected: view === id }}
            onPress={() => { stopAudio(); setSelected(id); }}
            style={[styles.viewButton, view === id && [styles.viewSelected, { backgroundColor: theme.surface }]]}>
            <Body muted={view !== id} style={styles.viewLabel}>{label}</Body>
          </PressableScale>
        ))}
      </View>

      {groups.length ? (
        <View style={styles.grid}>
          {groups.map((group) => (
            <SkillTile key={`${kind}:${group.id}`} group={group} progress={marked} now={progress ? now : null}
              onOpen={() => { stopAudio(); setOpen({ group, kind }); }} />
          ))}
        </View>
      ) : view === "phrases" ? (
        <Button label="Look up a phrase in Say" variant="secondary" onPress={() => router.push("/say")} />
      ) : (
        <Body muted>{view === "conversation"
          ? "Finish a conversation lesson to collect phrases by what they help you do."
          : "Patterns appear here after you finish a grammar lesson."}</Body>
      )}

      {olderLessons && view !== "phrases" ? (
        <Button label="Show earlier lessons" variant="secondary" loading={loadingOlder}
          onPress={() => { setLoadingOlder(true); setHistoryLimit((count) => count + HISTORY_PAGE_SIZE); }} />
      ) : null}

      <SkillDetail open={open} progress={marked} now={progress ? now : null} families={families} audio={audio}
        onClose={() => { stopAudio(); setOpen(null); }}
        onPractice={(group, cards) => start(group.title, cards, cards.some((card) => reviewIsDue(marked[card.id], now)))}
        onSay={(phraseId) => { stopAudio(); setOpen(null); router.push(`/say/${phraseId}`); }} />
      <SkillReviewModal visible={reviewVisible} session={session} uid={uid} pair={pair} week={week}
        onClose={() => setReviewVisible(false)} onSaved={saved} />
    </Screen>
  );
}

function WeekCard({ week, due, hasCards, synced, onStart, onToday }: {
  week: boolean[];
  due: number;
  hasCards: boolean;
  synced: boolean;
  onStart: () => void;
  onToday: () => void;
}) {
  const theme = useTheme();
  const done = week.filter(Boolean).length;
  const todayIndex = (new Date().getDay() + 6) % 7;
  const reached = done >= WEEKLY_GOAL_DAYS;
  const minutes = Math.max(1, Math.round(Math.min(due, 5) * 0.8));
  return (
    <View style={[styles.week, { backgroundColor: theme.navy }]}>
      <View style={styles.weekTop}>
        <ProgressRing size={84} stroke={9} progress={Math.min(1, done / WEEKLY_GOAL_DAYS)} color={theme.onDark} track="#1E3157">
          <Heading style={[styles.weekCount, { color: "#F5F7FB" }]}>{Math.min(done, 7)}/{WEEKLY_GOAL_DAYS}</Heading>
          <Body style={[styles.tiny, { color: "#AEBBD0" }]}>days</Body>
        </ProgressRing>
        <View style={styles.weekCopy}>
          <Body style={[styles.eyebrow, { color: theme.onDark }]}>This week</Body>
          <Heading style={styles.weekHeading}>
            {reached ? "Weekly goal reached. Extra days still count." : `Review on ${WEEKLY_GOAL_DAYS} days. Missed days don’t reset anything.`}
          </Heading>
        </View>
      </View>
      <View accessible accessibilityLabel={`Reviewed on ${done} of ${WEEKLY_GOAL_DAYS} days this week`} style={styles.days}>
        {DAY_LETTERS.map((letter, index) => {
          const today = index === todayIndex;
          return (
            <View key={DAY_NAMES[index]} style={styles.day}>
              <View style={[styles.dayDot, {
                backgroundColor: week[index] ? theme.onDark : "transparent",
                borderColor: week[index] ? theme.onDark : today ? "#F5F7FB" : "#2A3B59",
              }]}>
                {week[index] ? <Body style={[styles.check, { color: theme.navy }]}>✓</Body> : null}
              </View>
              <Body style={[styles.tiny, { color: today ? "#F5F7FB" : "#AEBBD0", fontWeight: today ? "800" : "500" }]}>{letter}</Body>
            </View>
          );
        })}
      </View>
      {hasCards ? (
        <PressableScale accessibilityRole="button" onPress={onStart}
          style={[styles.speakButton, { backgroundColor: theme.brand }]}>
          <MicGlyph color="#FFFFFF" size={20} />
          <Body style={styles.speakLabel}>
            {due && synced ? `Speak ${due} due ${due === 1 ? "phrase" : "phrases"} · ${minutes} min` : synced ? "Practice again" : "Start practicing"}
          </Body>
        </PressableScale>
      ) : (
        <View style={styles.weekEmpty}>
          <Body style={{ color: "#AEBBD0" }}>Finish a lesson to start your skill map.</Body>
          <Button label="Go to Today" onPress={onToday} />
        </View>
      )}
    </View>
  );
}

function StrengthCard({ counts }: { counts: readonly number[] }) {
  const theme = useTheme();
  const total = counts.reduce((sum, count) => sum + count, 0) || 1;
  const strong = (counts[3] ?? 0) + (counts[4] ?? 0);
  return (
    <Card style={styles.strength}>
      <View style={styles.strengthTop}>
        <Heading style={styles.cardHeading}>Phrase strength</Heading>
        <Body muted style={styles.small}>{strong} Strong or better</Body>
      </View>
      <View style={styles.stack} accessibilityElementsHidden>
        {counts.map((count, level) => count ? (
          <View key={level} style={{ flex: count / total, backgroundColor: levelColor(theme, level as MasteryLevel) }} />
        ) : null)}
      </View>
      <View style={styles.legend}>
        {counts.map((count, level) => (
          <View key={level} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: levelColor(theme, level as MasteryLevel) }]} />
            <Body style={styles.small}>{levelName(level as MasteryLevel)} {count}</Body>
          </View>
        ))}
      </View>
    </Card>
  );
}

function SkillTile({ group, progress, now, onOpen }: {
  group: SkillGroup;
  progress: ProgressByCard;
  now: number | null;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const pool = group.reviewCards ?? group.cards;
  const mastery = skillMastery(pool, progress);
  const due = now === null ? 0 : pool.filter((card) => reviewIsDue(progress[card.id], now)).length;
  const ring = mastery.level === 0 ? theme.textMuted : levelColor(theme, mastery.level);
  return (
    <PressableScale accessibilityRole="button"
      accessibilityLabel={`${group.title}. ${mastery.percent} percent, ${levelName(mastery.level)}. ${pool.length} phrases${due ? `, ${due} due` : ""}.`}
      onPress={onOpen}
      style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.tileTop}>
        <ProgressRing size={52} stroke={6} progress={mastery.percent / 100} color={ring} track={theme.surfaceMuted}>
          <Body style={styles.ringLabel}>{mastery.percent}%</Body>
        </ProgressRing>
        {mastery.level === 4 ? (
          <View style={[styles.chip, { backgroundColor: levelColor(theme, 4) }]}><Body style={[styles.chipLabel, { color: levelInk(theme, 4) }]}>Mastered</Body></View>
        ) : due ? (
          <View style={[styles.chip, { backgroundColor: theme.amber }]}><Body style={[styles.chipLabel, { color: theme.navy }]}>{due} due</Body></View>
        ) : null}
      </View>
      <Heading style={styles.tileTitle}>{group.title}</Heading>
      <View style={styles.segments}>
        {[0, 1, 2, 3, 4].map((level) => (
          <View key={level} style={[styles.segment, { backgroundColor: level <= mastery.level && mastery.level > 0 ? levelColor(theme, mastery.level) : theme.surfaceMuted }]} />
        ))}
      </View>
      <Body muted style={styles.tiny}>{levelName(mastery.level)} · {pool.length} {pool.length === 1 ? "phrase" : "phrases"}</Body>
    </PressableScale>
  );
}

function SkillDetail({ open, progress, now, families, audio, onClose, onPractice, onSay }: {
  open: OpenSkill | null;
  progress: ProgressByCard;
  now: number | null;
  families: ReadonlyMap<string, string>;
  audio: ReturnType<typeof useExampleAudio>;
  onClose: () => void;
  onPractice: (group: SkillGroup, cards: SkillCard[]) => void;
  onSay: (phraseId: string) => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={open !== null} animationType="slide" presentationStyle="pageSheet" backdropColor={theme.background} onRequestClose={onClose}>
      {open ? <SkillDetailContent key={`${open.kind}:${open.group.id}`} open={open} progress={progress} now={now} families={families}
        audio={audio} onClose={onClose} onPractice={onPractice} onSay={onSay} /> : null}
    </Modal>
  );
}

function SkillDetailContent({ open, progress, now, families, audio, onClose, onPractice, onSay }: {
  open: OpenSkill;
  progress: ProgressByCard;
  now: number | null;
  families: ReadonlyMap<string, string>;
  audio: ReturnType<typeof useExampleAudio>;
  onClose: () => void;
  onPractice: (group: SkillGroup, cards: SkillCard[]) => void;
  onSay: (phraseId: string) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { group, kind } = open;
  const pool = group.reviewCards ?? group.cards;
  const mastery = skillMastery(pool, progress);
  const due = now === null ? 0 : pool.filter((card) => reviewIsDue(progress[card.id], now)).length;
  const [visible, setVisible] = useState(PAGE_EXAMPLES);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Group variations under the first phrase of their family, keeping lesson order.
  const rows = useMemo(() => {
    const byFamily = new Map<string, SkillCard[]>();
    for (const card of group.cards) {
      const family = families.get(card.id) ?? card.id;
      byFamily.set(family, [...(byFamily.get(family) ?? []), card]);
    }
    return [...byFamily.entries()].map(([id, cards]) => ({ id, lead: cards[0]!, variations: cards.slice(1) }));
  }, [families, group.cards]);
  const next = mastery.level < 4 ? levelName((mastery.level + 1) as MasteryLevel) : null;

  return (
    <View style={[styles.sheet, { backgroundColor: theme.background }]}>
      <View style={[styles.sheetHeader, { borderColor: theme.border }]}>
        <Body muted style={styles.small}>{kind === "grammar" ? "Grammar skill" : kind === "conversation" ? "Conversation skill" : "Saved phrases"}</Body>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerClose}><Body style={{ color: theme.primary }}>Close</Body></Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.sheetContent, { paddingBottom: Math.max(24, insets.bottom + 12) }]}>
        <View style={styles.detailTop}>
          <ProgressRing size={104} stroke={10} progress={mastery.percent / 100}
            color={mastery.level === 0 ? theme.textMuted : levelColor(theme, mastery.level)} track={theme.surfaceMuted}>
            <Heading style={styles.detailPercent}>{mastery.percent}%</Heading>
            <Body muted style={styles.tiny}>{levelName(mastery.level)}</Body>
          </ProgressRing>
          <View style={styles.detailCopy}>
            <Title style={styles.detailTitle}>{group.title}</Title>
            <Body muted style={styles.small}>
              {next ? due ? `Review the due phrases to move toward ${next}.` : `Keep reviewing on schedule to reach ${next}.` : "Every phrase here is mastered."}
            </Body>
          </View>
        </View>
        {pool.length ? (
          <Button label={due ? `Speak ${due} due ${due === 1 ? "phrase" : "phrases"}` : "Practice this skill"} onPress={() => onPractice(group, pool)} />
        ) : null}
        {group.patterns?.map((pattern) => (
          <Card key={pattern.id} style={styles.pattern}>
            <Heading style={styles.cardHeading}>{pattern.title}</Heading>
            {pattern.description ? <Body muted style={styles.small}>{pattern.description}</Body> : null}
          </Card>
        ))}
        {rows.slice(0, visible).map((row) => (
          <View key={row.id} style={styles.family}>
            <PhraseRow card={row.lead} progress={progress[row.lead.id]} now={now} audio={audio} kind={kind} onSay={onSay}
              onPractice={() => onPractice(group, [row.lead])} />
            {row.variations.length ? (
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === row.id }}
                onPress={() => setExpanded((current) => current === row.id ? null : row.id)} style={styles.variationToggle}>
                <Body style={[styles.small, { color: theme.primary }]}>
                  {expanded === row.id ? "Hide variations" : `+${row.variations.length} ${row.variations.length === 1 ? "variation" : "variations"}`}
                </Body>
              </Pressable>
            ) : null}
            {expanded === row.id ? row.variations.map((card) => (
              <View key={card.id} style={[styles.variation, { borderColor: theme.border }]}>
                <PhraseRow card={card} progress={progress[card.id]} now={now} audio={audio} kind={kind} onSay={onSay}
                  onPractice={() => onPractice(group, [card])} />
              </View>
            )) : null}
          </View>
        ))}
        {rows.length > visible ? <Button label="Show more phrases" variant="ghost" onPress={() => setVisible((count) => count + PAGE_EXAMPLES)} /> : null}
      </ScrollView>
    </View>
  );
}

function PhraseRow({ card, progress, now, audio, kind, onSay, onPractice }: {
  card: SkillCard;
  progress: ReviewProgress | undefined;
  now: number | null;
  audio: ReturnType<typeof useExampleAudio>;
  kind: OpenSkill["kind"];
  onSay: (phraseId: string) => void;
  onPractice: () => void;
}) {
  const theme = useTheme();
  const level = masteryLevel(progress);
  const isDue = now !== null && progress !== undefined && reviewIsDue(progress, now);
  const fromLesson = progress?.lastMode === "lesson" && progress.lastRating === "got-it";
  return (
    <View style={[styles.phrase, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {card.audioPath ? (
        <Pressable accessibilityRole="button" accessibilityLabel={audio.label(card.audioPath)} accessibilityState={{ busy: audio.state(card.audioPath) === "loading" }}
          onPress={() => card.audioPath && void audio.play(card.audioPath)}
          style={[styles.play, { backgroundColor: theme.primaryTint }]}>
          <AudioGlyph state={audio.state(card.audioPath)} color={theme.primary} style={styles.playGlyph} />
        </Pressable>
      ) : null}
      <View style={styles.phraseCopy}>
        <Body style={styles.phraseTarget}>{card.target}</Body>
        <Body muted style={styles.small}>{card.meaning}</Body>
        {card.otherMeanings?.length ? <Body muted style={styles.small}>Also: {card.otherMeanings.join(" / ")}</Body> : null}
        {fromLesson ? (
          <View style={[styles.tag, { backgroundColor: theme.primaryTint }]}><Body style={[styles.tagLabel, { color: theme.primary }]}>Said right in a lesson</Body></View>
        ) : null}
        {kind === "phrases" ? (
          <View style={styles.phraseActions}>
            {card.phraseId ? <Pressable accessibilityRole="button" style={styles.inlineButton} onPress={() => card.phraseId && onSay(card.phraseId)}>
              <Body style={[styles.small, { color: theme.primary }]}>Open in Say</Body>
            </Pressable> : null}
            <Pressable accessibilityRole="button" style={styles.inlineButton} onPress={onPractice}>
              <Body style={[styles.small, { color: theme.primary }]}>Practice phrase</Body>
            </Pressable>
          </View>
        ) : null}
      </View>
      <View accessible accessibilityLabel={isDue ? `${levelName(level)}, due now` : levelName(level)} style={styles.phraseLevel}>
        <View style={styles.pips}>
          {[0, 1, 2, 3, 4].map((step) => (
            <View key={step} style={[styles.pip, { backgroundColor: step <= level && level > 0 ? levelColor(theme, level) : theme.surfaceMuted }]} />
          ))}
        </View>
        <Body style={[styles.tiny, { color: isDue ? theme.text : theme.textMuted, fontWeight: isDue ? "700" : "500" }]}>{isDue ? "Due now" : levelName(level)}</Body>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  headerCopy: { gap: 4 },
  languageRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  flag: { fontSize: 18, lineHeight: 22 },
  languageLabel: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  countChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 2 },
  countLabel: { fontSize: 13, lineHeight: 17, fontWeight: "700" },
  small: { fontSize: 13, lineHeight: 19 },
  tiny: { fontSize: 12, lineHeight: 16 },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  week: { borderRadius: 24, padding: 18, gap: 16 },
  weekTop: { flexDirection: "row", alignItems: "center", gap: 16 },
  weekCount: { fontSize: 21, lineHeight: 24 },
  weekCopy: { flex: 1, gap: 4 },
  weekHeading: { color: "#F5F7FB", fontSize: 17, lineHeight: 23 },
  days: { flexDirection: "row", justifyContent: "space-between" },
  day: { alignItems: "center", gap: 5, width: 36 },
  dayDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  check: { fontSize: 15, lineHeight: 18, fontWeight: "900" },
  speakButton: { minHeight: 56, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 16 },
  speakLabel: { color: "#FFFFFF", fontSize: 17, lineHeight: 22, fontWeight: "700" },
  weekEmpty: { gap: 10 },
  strength: { gap: 11 },
  strengthTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  cardHeading: { fontSize: 17, lineHeight: 23 },
  stack: { flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", gap: 2 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  viewPicker: { flexDirection: "row", padding: 3, gap: 4, borderRadius: 999 },
  viewButton: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 999, paddingHorizontal: 3 },
  viewSelected: { shadowColor: "#08152F", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  viewLabel: { fontSize: 14, lineHeight: 19, fontWeight: "700", textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { flexGrow: 1, flexBasis: "45%", minHeight: 168, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 14, gap: 10 },
  tileTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  ringLabel: { fontSize: 13, lineHeight: 16, fontWeight: "800" },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipLabel: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  tileTitle: { fontSize: 15, lineHeight: 20 },
  segments: { flexDirection: "row", gap: 3, marginTop: "auto" },
  segment: { flex: 1, height: 5, borderRadius: 3 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingVertical: 8 },
  headerClose: { minHeight: 44, justifyContent: "center", paddingLeft: 16 },
  sheetContent: { padding: 20, gap: 12 },
  detailTop: { flexDirection: "row", alignItems: "center", gap: 18, marginBottom: 4 },
  detailPercent: { fontSize: 26, lineHeight: 30 },
  detailCopy: { flex: 1, gap: 6 },
  detailTitle: { fontSize: 24, lineHeight: 30 },
  pattern: { gap: 3 },
  family: { gap: 6 },
  phrase: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 13 },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  playGlyph: { fontSize: 15, lineHeight: 18, fontWeight: "800" },
  phraseCopy: { flex: 1, gap: 2 },
  phraseTarget: { fontSize: 16, lineHeight: 21, fontWeight: "600" },
  tag: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 },
  tagLabel: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  phraseActions: { flexDirection: "row", flexWrap: "wrap", columnGap: 15 },
  inlineButton: { minHeight: 44, justifyContent: "center" },
  phraseLevel: { alignItems: "flex-end", gap: 5 },
  pips: { flexDirection: "row", gap: 3 },
  pip: { width: 8, height: 16, borderRadius: 3 },
  variationToggle: { minHeight: 36, justifyContent: "center", paddingLeft: 14 },
  variation: { marginLeft: 14, paddingLeft: 10, borderLeftWidth: 2 },
});
