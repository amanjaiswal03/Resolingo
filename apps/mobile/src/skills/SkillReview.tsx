import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { languageById } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { MicGlyph } from "@/components/MicGlyph";
import { ProgressRing } from "@/components/ProgressRing";
import { Body, Heading, Title } from "@/components/Typography";
import { gradePhrase, wordMatches, type WordMatch } from "@/lesson/phrase-match";
import { useTheme } from "@/theme/tokens";
import { levelColor, levelInk, levelName } from "./levels";
import {
  masteryLevel, progressForCard, WEEKLY_GOAL_DAYS, type LanguagePair, type MasteryLevel, type ProgressByCard, type ReviewProgress, type ReviewQuestion, type ReviewRating,
} from "./model";
import { recordSkillReview } from "./progress";
import { useExampleAudio } from "./use-example-audio";
import { useSpeechAnswer, type SpeechAnswer } from "./use-speech-answer";

export type SkillSession = { id: string; title: string; questions: ReviewQuestion[]; before: ProgressByCard };
type Spoken = { matched: number; total: number };
type Reviewed = { question: ReviewQuestion; rating: ReviewRating; progress?: ReviewProgress; from: MasteryLevel; to: MasteryLevel; spoken?: Spoken };

type ReviewProps = {
  visible: boolean;
  session: SkillSession | null;
  uid: string;
  pair: LanguagePair;
  week: boolean[];
  onClose: () => void;
  onSaved: (id: string, progress: ReviewProgress) => void;
};

export function SkillReviewModal({ visible, session, onClose, ...rest }: ReviewProps) {
  const theme = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" backdropColor={theme.background} onRequestClose={onClose}>
      {session ? <ReviewContent key={session.id} session={session} onClose={onClose} {...rest} /> : null}
    </Modal>
  );
}

function ReviewContent({ session, uid, pair, week, onClose, onSaved }: Omit<ReviewProps, "session" | "visible"> & { session: SkillSession }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [completed, setCompleted] = useState<Reviewed[]>([]);
  const audio = useExampleAudio();
  const question = session.questions[completed.length];
  const close = () => { audio.stop(); onClose(); };
  const total = session.questions.length;
  return (
    <View style={[styles.sheet, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={question ? "End review" : "Close"} onPress={close} style={styles.closeButton}>
          <Body style={[styles.closeGlyph, { color: theme.textMuted }]}>✕</Body>
        </Pressable>
        {question ? (
          <>
            <View accessibilityElementsHidden style={styles.progress}>
              {session.questions.map((item, index) => (
                <View key={item.card.id} style={[styles.progressSegment, {
                  backgroundColor: index < completed.length ? theme.brand : index === completed.length ? theme.mint : theme.surfaceMuted,
                }]} />
              ))}
            </View>
            <Body muted accessibilityLabel={`Question ${completed.length + 1} of ${total}`} style={styles.count}>{completed.length + 1}/{total}</Body>
          </>
        ) : <Heading accessibilityRole="header" style={styles.headerTitle}>Review complete</Heading>}
      </View>
      <ScrollView key={question?.card.id ?? "recap"} keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(24, insets.bottom + 10) }]}>
        {question ? (
          <QuestionCard
            question={question}
            from={masteryLevel(progressForCard(question.card, session.before))}
            last={completed.length + 1 === total}
            pair={pair}
            audio={audio}
            save={async (attempt) => {
              const updated = await recordSkillReview(uid, pair, question.card, { ...attempt, mode: question.mode });
              onSaved(question.card.id, updated);
              return updated;
            }}
            onNext={(reviewed) => { audio.stop(); setCompleted((items) => [...items, reviewed]); }}
          />
        ) : <ReviewRecap completed={completed} week={week} onClose={close} />}
      </ScrollView>
    </View>
  );
}

type Attempt = { rating: ReviewRating; attemptId: string; now: number };
type Stage = "prompt" | "listening" | "checking" | "result" | "reveal";
type Result = { heard: string; level: "matched" | "close" | "retry" | "unclear"; words: WordMatch[] };

function autoRating(result: Result, tries: number): ReviewRating {
  if (result.level === "matched") return tries > 1 ? "almost" : "got-it";
  return result.level === "close" ? "almost" : "forgot";
}

function QuestionCard({ question, from, last, pair, audio, save, onNext }: {
  question: ReviewQuestion;
  from: MasteryLevel;
  last: boolean;
  pair: LanguagePair;
  audio: ReturnType<typeof useExampleAudio>;
  save: (attempt: Attempt) => Promise<ReviewProgress>;
  onNext: (reviewed: Reviewed) => void;
}) {
  const theme = useTheme();
  const speech = useSpeechAnswer();
  const { card } = question;
  const [stage, setStage] = useState<Stage>("prompt");
  const [hint, setHint] = useState(false);
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [firstTry, setFirstTry] = useState<Spoken | undefined>();
  const [notice, setNotice] = useState<{ text: string; settings?: boolean } | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [showWords, setShowWords] = useState(!card.audioPath);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [saved, setSaved] = useState<Reviewed | null>(null);
  const [error, setError] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; speech.cancel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (rating: ReviewRating, spoken = firstTry) => {
    if (saving.current || saved) return;
    saving.current = true;
    const entry = attempt?.rating === rating ? attempt : { rating, attemptId: randomUUID(), now: Date.now() };
    setAttempt(entry);
    setError(false);
    try {
      const progress = await save(entry);
      if (!mounted.current) return;
      const to = masteryLevel(progress);
      if (to > from) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setSaved({ question, rating: entry.rating, progress, from, to, ...(spoken ? { spoken } : {}) });
    } catch {
      if (mounted.current) setError(true);
    } finally {
      saving.current = false;
    }
  };

  const listen = () => {
    setNotice(null);
    audio.stop();
    setStage("listening");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    void speech.start((answer: SpeechAnswer) => {
      if (!mounted.current) return;
      if (answer.kind === "heard") {
        const grade = gradePhrase(card.target, answer.heard, pair.targetLanguage);
        const words = wordMatches(card.target, answer.heard, pair.targetLanguage);
        const next = { heard: answer.heard, level: grade.level === "matched" || grade.level === "close" || grade.level === "retry" ? grade.level : "unclear", words } as Result;
        const spoken = tries === 0 ? { matched: words.filter((word) => word.matched).length, total: words.length } : firstTry;
        if (tries === 0) setFirstTry(spoken);
        setTries(tries + 1);
        setResult(next);
        setStage("result");
        // A match is final, so save it right away. Anything else waits for a retry or a self-rating.
        if (next.level === "matched") void submit(autoRating(next, tries + 1), spoken);
        return;
      }
      setStage("prompt");
      if (answer.kind === "no-speech") setNotice({ text: "Didn’t catch that. Tap the mic and try again." });
      else if (answer.kind === "permission") setNotice({ text: "The microphone is off. Turn it on in Settings, or reveal the answer instead.", settings: true });
      else setNotice({ text: `${answer.message} You can reveal the answer instead.` });
    });
  };


  const retry = () => {
    setResult(null);
    setStage("prompt");
    if (card.audioPath) void audio.play(card.audioPath);
  };

  if (question.mode === "recognition") {
    const picked = attempt !== null;
    return (
      <>
        <LevelRow skillLevel={from} />
        <Card style={styles.promptCard}>
          <Body muted style={styles.small}>What does this mean?</Body>
          {card.audioPath ? (
            <Pressable accessibilityRole="button" accessibilityLabel={audio.label(card.audioPath)} onPress={() => card.audioPath && void audio.play(card.audioPath)}
              style={[styles.listenButton, { backgroundColor: theme.primaryFill }]}>
              <Body style={styles.listenGlyph}>▶</Body>
            </Pressable>
          ) : null}
          {showWords || picked ? <Heading style={styles.prompt}>{card.target}</Heading> : (
            <Pressable accessibilityRole="button" onPress={() => setShowWords(true)} style={styles.inline}>
              <Body style={{ color: theme.primary }}>Show the words</Body>
            </Pressable>
          )}
        </Card>
        {question.options.map((option) => {
          const right = option === card.meaning;
          const chosen = option === choice;
          const background = picked && right ? theme.successFill : picked && chosen ? "#FFE3DD" : theme.surface;
          const border = picked && right ? theme.success : picked && chosen ? theme.coral : theme.border;
          return (
            <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: chosen, disabled: picked }} disabled={picked}
              onPress={() => { setChoice(option); void submit(right ? "got-it" : "forgot"); }}
              style={[styles.option, { backgroundColor: background, borderColor: border, borderWidth: picked && (right || chosen) ? 2 : StyleSheet.hairlineWidth }]}>
              <Body style={picked && (right || chosen) ? { color: theme.navy, fontWeight: "700" } : undefined}>{option}</Body>
            </Pressable>
          );
        })}
        {picked ? <Body accessibilityLiveRegion="polite" style={[styles.feedback, { color: choice === card.meaning ? theme.success : theme.danger }]}>
          {choice === card.meaning ? "Right. You understood it." : `It means “${card.meaning}”.`}
        </Body> : null}
        <SaveFooter attempt={attempt} saved={saved} error={error} last={last} onRetry={() => attempt && void submit(attempt.rating)}
          onSkip={() => attempt && onNext({ question, rating: attempt.rating, from, to: from })} onNext={() => saved && onNext(saved)} />
      </>
    );
  }

  // The recorder knows when listening has turned into checking.
  const shown: Stage = stage === "listening" && speech.phase === "checking" ? "checking" : stage;
  const hintText = card.target.split(/\s+/u).slice(0, card.target.split(/\s+/u).length > 4 ? 2 : 1).join(" ");
  return (
    <>
      <LevelRow skillLevel={saved ? saved.to : from} />
      <Card style={styles.promptCard}>
        <Body muted style={styles.small}>Say it in {languageById[pair.targetLanguage].label}</Body>
        <Title style={styles.meaning}>{card.meaning}</Title>
        {hint && shown !== "result" && shown !== "reveal" ? <Body style={[styles.hint, { color: theme.primary }]}>Starts with “{hintText} …”</Body> : null}
      </Card>

      {shown === "prompt" ? (
        <>
          <View style={styles.micArea}>
            <Pressable accessibilityRole="button" accessibilityLabel="Tap and speak" onPress={listen}
              style={({ pressed }) => [styles.mic, { backgroundColor: pressed ? theme.primaryPressed : theme.primaryFill }]}>
              <MicGlyph color="#FFFFFF" size={44} />
            </Pressable>
            <Body style={styles.micLabel}>{tries ? "Listen once more, then try again" : "Tap and say it out loud"}</Body>
          </View>
          {notice ? (
            <Card style={{ backgroundColor: theme.surfaceMuted, borderWidth: 0 }}>
              <Body accessibilityLiveRegion="polite">{notice.text}</Body>
              {notice.settings ? <Button label="Open Settings" variant="secondary" onPress={() => void Linking.openSettings()} /> : null}
            </Card>
          ) : null}
          <View style={styles.row}>
            <View style={styles.flex}><Button label={hint ? "Hide hint" : "Show a hint"} variant="secondary" onPress={() => setHint((value) => !value)} /></View>
            <View style={styles.flex}><Button label="Can’t speak now" variant="secondary" onPress={() => setStage("reveal")} /></View>
          </View>
        </>
      ) : null}

      {shown === "listening" ? <Listening level={speech.level} onStop={speech.stop} /> : null}

      {shown === "checking" ? (
        <View style={styles.micArea}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Body style={styles.micLabel} accessibilityLiveRegion="polite">Checking…</Body>
        </View>
      ) : null}

      {shown === "result" && result ? (
        <ResultCard result={result} tries={tries} card={card} audio={audio}
          saved={saved} from={from} last={last} attempt={attempt} error={error}
          onRetry={retry}
          onNext={() => saved ? onNext(saved) : void submit(autoRating(result, tries))}
          onSkip={() => void submit(autoRating(result, tries))}
          onOverride={() => setStage("reveal")}
          onRetrySave={() => attempt && void submit(attempt.rating)}
          onContinueUnsaved={() => attempt && onNext({ question, rating: attempt.rating, from, to: from, ...(firstTry ? { spoken: firstTry } : {}) })} />
      ) : null}

      {shown === "reveal" ? (
        <>
          <View style={[styles.answer, { backgroundColor: theme.primaryTint }]}>
            {card.audioPath ? (
              <Pressable accessibilityRole="button" accessibilityLabel={audio.label(card.audioPath)} onPress={() => card.audioPath && void audio.play(card.audioPath)}
                style={[styles.smallPlay, { backgroundColor: theme.primaryFill }]}>
                <Body style={styles.listenGlyph}>▶</Body>
              </Pressable>
            ) : null}
            <Heading style={styles.answerText}>{card.target}</Heading>
          </View>
          {!attempt ? (
            <>
              <Body muted style={styles.center}>Say it to yourself. How did it go?</Body>
              <View style={styles.ratings}>
                <RatingButton label="Forgot" fill="#FFE3DD" ink="#8A2412" onPress={() => void submit("forgot")} />
                <RatingButton label="Almost" fill={theme.amber} ink={theme.navy} onPress={() => void submit("almost")} />
                <RatingButton label="Got it" fill={theme.primaryFill} ink="#FFFFFF" onPress={() => void submit("got-it")} />
              </View>
            </>
          ) : null}
          {saved && saved.to > saved.from ? <LevelUp from={saved.from} to={saved.to} /> : null}
          <SaveFooter attempt={attempt} saved={saved} error={error} last={last} onRetry={() => attempt && void submit(attempt.rating)}
            onSkip={() => attempt && onNext({ question, rating: attempt.rating, from, to: from })} onNext={() => saved && onNext(saved)} />
        </>
      ) : null}
    </>
  );
}

function LevelRow({ skillLevel }: { skillLevel: MasteryLevel }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel={`Phrase strength: ${levelName(skillLevel)}`} style={styles.levelRow}>
      <View style={styles.pips}>
        {[0, 1, 2, 3, 4].map((step) => (
          <View key={step} style={[styles.pip, { backgroundColor: step <= skillLevel && skillLevel > 0 ? levelColor(theme, skillLevel) : theme.surfaceMuted }]} />
        ))}
      </View>
      <Body muted style={styles.tiny}>{levelName(skillLevel)}</Body>
    </View>
  );
}

function Listening({ level, onStop }: { level: number; onStop: () => void }) {
  const theme = useTheme();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const ring = (offset: number) => {
    const value = Animated.modulo(Animated.add(pulse, offset), 1);
    return { transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }], opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }) };
  };
  const bars = [0.4, 0.7, 1, 0.6, 0.85, 1, 0.5, 0.8, 0.95, 0.55, 0.75, 0.9];
  return (
    <View style={styles.micArea}>
      <View style={styles.micStack}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.pulse, { backgroundColor: theme.brand }, ring(0)]} />
        <Animated.View style={[StyleSheet.absoluteFill, styles.pulse, { backgroundColor: theme.brand }, ring(0.5)]} />
        <Pressable accessibilityRole="button" accessibilityLabel="Done speaking" onPress={onStop} style={[styles.mic, { backgroundColor: theme.navy }]}>
          <View style={[styles.stopSquare, { backgroundColor: theme.onDark }]} />
        </Pressable>
      </View>
      <View accessibilityElementsHidden style={styles.wave}>
        {bars.map((shape, index) => (
          <View key={index} style={[styles.waveBar, { backgroundColor: theme.brand, height: 6 + Math.max(0.15, level) * 30 * shape }]} />
        ))}
      </View>
      <Body style={styles.micLabel} accessibilityLiveRegion="polite">Listening… tap when you’re done</Body>
    </View>
  );
}

function ResultCard({ result, tries, card, audio, saved, from, last, attempt, error, onRetry, onNext, onSkip, onOverride, onRetrySave, onContinueUnsaved }: {
  result: Result;
  tries: number;
  card: ReviewQuestion["card"];
  audio: ReturnType<typeof useExampleAudio>;
  saved: Reviewed | null;
  from: MasteryLevel;
  last: boolean;
  attempt: Attempt | null;
  error: boolean;
  onRetry: () => void;
  onNext: () => void;
  onSkip: () => void;
  onOverride: () => void;
  onRetrySave: () => void;
  onContinueUnsaved: () => void;
}) {
  const theme = useTheme();
  const matched = result.level === "matched";
  const missed = result.words.filter((word) => !word.matched).length;
  const canRetry = !matched && tries < 2 && !attempt;
  const title = matched ? (tries > 1 ? "Got it on the second try" : missed ? "Matched" : "Spot on")
    : result.level === "close" ? `Close, ${missed === 1 ? "one word" : `${missed} words`} off`
    : "Not quite yet";
  const subtitle = matched ? (missed ? "Watch the highlighted word next time." : "That phrase is getting stronger.")
    : canRetry ? "Listen to the native audio, then try once more." : "It will come back sooner so you can practise it.";
  return (
    <View style={styles.result}>
      <View style={[styles.resultBox, { backgroundColor: matched ? "#E7F6EC" : result.level === "close" ? "#FFF6DF" : "#FFEDE9" }]}>
        <View style={styles.resultTop}>
          <View style={[styles.badge, { backgroundColor: matched ? theme.success : result.level === "close" ? theme.amber : theme.coral }]}>
            <Body style={[styles.badgeGlyph, { color: matched ? "#FFFFFF" : theme.navy }]}>{matched ? "✓" : result.level === "close" ? "~" : "↻"}</Body>
          </View>
          <View style={styles.flex}>
            <Heading accessibilityLiveRegion="polite" style={[styles.resultTitle, { color: "#101A30" }]}>{title}</Heading>
            <Body style={[styles.small, { color: "#344054" }]}>{subtitle}</Body>
          </View>
        </View>
        <View accessible accessibilityLabel={`Model answer: ${card.target}. ${missed ? `${missed} missed` : "All words matched"}.`} style={styles.words}>
          {result.words.map((word, index) => (
            <View key={`${word.text}-${index}`} style={[styles.word, word.matched
              ? { backgroundColor: "#FFFFFF", borderColor: "#9ED9CE", borderStyle: "solid" }
              : { backgroundColor: "#FFE3DD", borderColor: "#E0573F", borderStyle: "dashed" }]}>
              <Body style={[styles.wordText, { color: word.matched ? "#0B5E53" : "#8A2412" }]}>{word.text}</Body>
            </View>
          ))}
        </View>
        <Body style={[styles.small, { color: "#344054" }]}>We heard: “{result.heard}”</Body>
      </View>
      {card.audioPath ? <Button label={audio.label(card.audioPath) === "Hear example" ? "Hear a native speaker" : audio.label(card.audioPath)} variant="secondary"
        onPress={() => card.audioPath && void audio.play(card.audioPath)} /> : null}
      {saved && saved.to > from ? <LevelUp from={from} to={saved.to} /> : null}
      {canRetry ? <Button label="Listen and try again" onPress={onRetry} /> : null}
      {error && attempt ? (
        <>
          <Body muted>Couldn’t save your answer.</Body>
          <Button label="Retry save" onPress={onRetrySave} />
          <Button label="Continue without saving" variant="secondary" onPress={onContinueUnsaved} />
        </>
      ) : attempt && !saved ? <Body muted accessibilityLiveRegion="polite">Saving…</Body> : (
        <Button label={saved ? (last ? "See results" : "Next") : canRetry ? "Skip for now" : (last ? "See results" : "Next")}
          variant={canRetry && !saved ? "secondary" : "primary"} onPress={saved ? onNext : canRetry ? onSkip : onNext} />
      )}
      {!attempt ? (
        <Pressable accessibilityRole="button" onPress={onOverride} style={styles.inline}>
          <Body style={[styles.small, styles.center, { color: theme.primary }]}>Didn’t hear you right? Rate it yourself</Body>
        </Pressable>
      ) : null}
    </View>
  );
}

function RatingButton({ label, fill, ink, onPress }: { label: string; fill: string; ink: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.rating, { backgroundColor: fill, opacity: pressed ? 0.8 : 1 }]}>
      <Body style={[styles.ratingLabel, { color: ink }]}>{label}</Body>
    </Pressable>
  );
}

function LevelUp({ from, to }: { from: MasteryLevel; to: MasteryLevel }) {
  const theme = useTheme();
  const [scale] = useState(() => new Animated.Value(0.6));
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, [scale]);
  return (
    <Animated.View accessible accessibilityLabel={`Level up: ${levelName(from)} to ${levelName(to)}`} style={[styles.levelUp, { transform: [{ scale }] }]}>
      <View style={[styles.levelChip, { backgroundColor: levelColor(theme, from) }]}><Body style={[styles.levelChipText, { color: levelInk(theme, from) }]}>{levelName(from)}</Body></View>
      <Body style={styles.arrow}>→</Body>
      <View style={[styles.levelChip, { backgroundColor: levelColor(theme, to) }]}><Body style={[styles.levelChipText, { color: levelInk(theme, to) }]}>{levelName(to)}</Body></View>
    </Animated.View>
  );
}

function SaveFooter({ attempt, saved, error, last, onRetry, onSkip, onNext }: {
  attempt: Attempt | null;
  saved: Reviewed | null;
  error: boolean;
  last: boolean;
  onRetry: () => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  if (!attempt) return null;
  if (saved) return <Button label={last ? "See results" : "Next"} onPress={onNext} />;
  if (error) {
    return (
      <>
        <Body muted>Couldn’t save your answer.</Body>
        <Button label="Retry save" onPress={onRetry} />
        <Button label="Continue without saving" variant="secondary" onPress={onSkip} />
      </>
    );
  }
  return <Body muted accessibilityLiveRegion="polite">Saving…</Body>;
}

function ReviewRecap({ completed, week, onClose }: { completed: Reviewed[]; week: boolean[]; onClose: () => void }) {
  const theme = useTheme();
  const todayIndex = (new Date().getDay() + 6) % 7;
  const savedAny = completed.some((entry) => entry.progress);
  const days = week.filter(Boolean).length + (savedAny && !week[todayIndex] ? 1 : 0);
  const remaining = Math.max(0, WEEKLY_GOAL_DAYS - days);
  const ups = completed.filter((entry) => entry.to > entry.from);
  const spoken = completed.flatMap((entry) => entry.spoken ? [entry.spoken] : []);
  const words = spoken.reduce((sum, entry) => ({ matched: sum.matched + entry.matched, total: sum.total + entry.total }), { matched: 0, total: 0 });
  const unsaved = completed.filter((entry) => !entry.progress).length;
  return (
    <>
      <View style={styles.recapTop}>
        <ProgressRing size={120} stroke={12} progress={Math.min(1, days / WEEKLY_GOAL_DAYS)} color={theme.brand} track={theme.surfaceMuted}>
          <Heading style={styles.recapCount}>{Math.min(days, 7)}/{WEEKLY_GOAL_DAYS}</Heading>
          <Body muted style={styles.tiny}>days this week</Body>
        </ProgressRing>
        <Title style={styles.center}>{ups.length ? "Nice session" : "Session done"}</Title>
        <Body muted style={styles.center}>
          {remaining === 0 ? "This week’s goal is reached. Extra days still help." : remaining === 1 ? "One more day reaches this week’s goal." : `${remaining} more days reach this week’s goal.`}
        </Body>
      </View>
      <View style={styles.row}>
        {words.total ? (
          <Card style={styles.stat}>
            <Heading style={styles.statValue}>{words.matched} of {words.total}</Heading>
            <Body muted style={styles.small}>words said right on the first try</Body>
          </Card>
        ) : null}
        <Card style={styles.stat}>
          <Heading style={styles.statValue}>{ups.length}</Heading>
          <Body muted style={styles.small}>{ups.length === 1 ? "phrase levelled up" : "phrases levelled up"}</Body>
        </Card>
      </View>
      <Card style={styles.recapList}>
        {completed.map((entry, index) => {
          const up = entry.to > entry.from;
          const again = entry.rating !== "got-it";
          const days = entry.progress?.intervalDays;
          const badge = up ? `${levelName(entry.from)} → ${levelName(entry.to)}` : again ? "Practise again" : `Held at ${levelName(entry.to)}`;
          const note = again && days ? (days === 1 ? "Back tomorrow" : `Back in ${days} days`) : entry.question.card.meaning;
          return (
            <View key={entry.question.card.id} style={[styles.recapRow, index < completed.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border }]}>
              <View style={styles.flex}>
                <Body style={styles.recapPhrase}>{entry.question.card.target}</Body>
                <Body muted style={styles.tiny}>{note}</Body>
              </View>
              <View style={[styles.levelChip, { backgroundColor: up ? levelColor(theme, entry.to) : again ? theme.amber : theme.primaryTint }]}>
                <Body style={[styles.levelChipText, { color: up ? levelInk(theme, entry.to) : again ? theme.navy : theme.primary }]}>{badge}</Body>
              </View>
            </View>
          );
        })}
      </Card>
      {unsaved ? <Body muted>Progress couldn’t sync for {unsaved} {unsaved === 1 ? "answer" : "answers"}.</Body> : null}
      <Button label="Done" onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeGlyph: { fontSize: 20, lineHeight: 24 },
  headerTitle: { flex: 1 },
  progress: { flex: 1, flexDirection: "row", gap: 4 },
  progressSegment: { flex: 1, height: 8, borderRadius: 4 },
  count: { width: 36, textAlign: "right", fontSize: 14, fontWeight: "600" },
  content: { padding: 20, paddingTop: 10, gap: 14 },
  small: { fontSize: 13, lineHeight: 19 },
  tiny: { fontSize: 12, lineHeight: 16 },
  center: { textAlign: "center" },
  flex: { flex: 1 },
  row: { flexDirection: "row", gap: 10 },
  inline: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  levelRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  pips: { flexDirection: "row", gap: 3 },
  pip: { width: 7, height: 14, borderRadius: 2 },
  promptCard: { gap: 10, paddingVertical: 22 },
  meaning: { fontSize: 26, lineHeight: 32 },
  prompt: { fontSize: 23, lineHeight: 29, textAlign: "center" },
  hint: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  micArea: { alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 22 },
  micStack: { width: 112, height: 112 },
  pulse: { borderRadius: 56 },
  mic: { width: 112, height: 112, borderRadius: 56, alignItems: "center", justifyContent: "center" },
  stopSquare: { width: 30, height: 30, borderRadius: 8 },
  micLabel: { fontSize: 15, lineHeight: 21, fontWeight: "600", textAlign: "center" },
  wave: { flexDirection: "row", alignItems: "center", gap: 5, height: 40 },
  waveBar: { width: 5, borderRadius: 3 },
  listenButton: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  listenGlyph: { color: "#FFFFFF", fontSize: 20, lineHeight: 24, fontWeight: "800" },
  option: { minHeight: 56, paddingHorizontal: 16, justifyContent: "center", borderRadius: 16 },
  feedback: { textAlign: "center", fontWeight: "700" },
  result: { gap: 12 },
  resultBox: { borderRadius: 20, padding: 16, gap: 12 },
  resultTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  badgeGlyph: { fontSize: 18, lineHeight: 22, fontWeight: "900" },
  resultTitle: { fontSize: 18, lineHeight: 23 },
  words: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  word: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  wordText: { fontSize: 17, lineHeight: 22, fontWeight: "700" },
  answer: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 20, padding: 16 },
  smallPlay: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  answerText: { flex: 1, fontSize: 20, lineHeight: 26 },
  ratings: { flexDirection: "row", gap: 8 },
  rating: { flex: 1, minHeight: 56, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  ratingLabel: { fontSize: 15, fontWeight: "700" },
  levelUp: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  levelChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  levelChipText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  arrow: { fontSize: 18, fontWeight: "700" },
  recapTop: { alignItems: "center", gap: 10, paddingTop: 10 },
  recapCount: { fontSize: 28, lineHeight: 32 },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: 24, lineHeight: 30 },
  recapList: { paddingVertical: 4, gap: 0 },
  recapRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  recapPhrase: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
});
