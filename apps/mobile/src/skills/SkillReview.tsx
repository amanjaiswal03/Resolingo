import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Body, Heading, Title } from "@/components/Typography";
import { useTheme } from "@/theme/tokens";
import { type LanguagePair, type ReviewProgress, type ReviewQuestion, type ReviewRating } from "./model";
import { recordSkillReview } from "./progress";
import { useExampleAudio } from "./use-example-audio";

export type SkillSession = { id: string; title: string; questions: ReviewQuestion[] };
type Reviewed = { question: ReviewQuestion; rating: ReviewRating; progress?: ReviewProgress };
const labels: Record<ReviewRating, string> = { "got-it": "Got it", almost: "Almost", forgot: "Forgot" };

type ReviewProps = {
  visible: boolean;
  session: SkillSession | null;
  uid: string;
  pair: LanguagePair;
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

function ReviewContent({ session, uid, pair, onClose, onSaved }: Omit<ReviewProps, "session" | "visible"> & { session: SkillSession }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [completed, setCompleted] = useState<Reviewed[]>([]);
  const audio = useExampleAudio();
  const question = session.questions[completed.length];
  const close = () => { audio.stop(); onClose(); };
  return (
    <View style={[styles.sheet, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderColor: theme.border }]}>
        <Heading accessibilityRole="header" numberOfLines={2} style={styles.headerTitle}>{question ? session.title : "Review complete"}</Heading>
        <Pressable accessibilityRole="button" onPress={close} style={styles.headerClose}><Body style={{ color: theme.primary }}>Close</Body></Pressable>
      </View>
      <ScrollView key={question?.card.id ?? "recap"} contentContainerStyle={[styles.content, { paddingBottom: Math.max(24, insets.bottom + 10) }]}>
        {question ? (
          <QuestionCard
            question={question}
            number={completed.length + 1}
            total={session.questions.length}
            audio={audio}
            save={async (attempt) => {
              const updated = await recordSkillReview(uid, pair, question.card, { ...attempt, mode: question.mode });
              onSaved(question.card.id, updated);
              return updated;
            }}
            onNext={(reviewed) => { audio.stop(); setCompleted((items) => [...items, reviewed]); }}
          />
        ) : <ReviewRecap completed={completed} onClose={close} />}
      </ScrollView>
    </View>
  );
}

type Attempt = { rating: ReviewRating; attemptId: string; now: number };

function QuestionCard({ question, number, total, audio, save, onNext }: {
  question: ReviewQuestion;
  number: number;
  total: number;
  audio: ReturnType<typeof useExampleAudio>;
  save: (attempt: Attempt) => Promise<ReviewProgress>;
  onNext: (reviewed: Reviewed) => void;
}) {
  const theme = useTheme();
  const [revealed, setRevealed] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [saved, setSaved] = useState<Reviewed | null>(null);
  const [error, setError] = useState(false);
  const saving = useRef(false);
  const recognition = question.mode === "recognition";
  const { card } = question;

  const submit = async (rating: ReviewRating) => {
    if (saving.current || saved) return;
    saving.current = true;
    const entry = attempt ?? { rating, attemptId: randomUUID(), now: Date.now() };
    setAttempt(entry);
    setError(false);
    try {
      const progress = await save(entry);
      setSaved({ question, rating: entry.rating, progress });
    } catch {
      setError(true);
    } finally {
      saving.current = false;
    }
  };

  return (
    <>
      <View style={styles.questionMeta}>
        <Body muted style={styles.small}>Question {number} of {total}</Body>
        <View accessibilityElementsHidden style={styles.progressDots}>
          {Array.from({ length: total }, (_, index) => <View key={index} style={[styles.progressDot, { backgroundColor: index < number ? theme.primary : theme.border }]} />)}
        </View>
      </View>
      <Card>
        <Title style={styles.questionTitle}>{recognition ? "What does this mean?" : "Could you say it now?"}</Title>
        <Heading style={styles.prompt}>{recognition ? card.target : card.meaning}</Heading>
        {!recognition && !revealed ? <Body muted>Say it aloud or think of the phrase, then reveal the example.</Body> : null}
      </Card>
      {question.mode === "recognition" && !attempt ? (
        <>
          {question.options.map((option) => (
            <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: choice === option }} onPress={() => setChoice(option)}
              style={[styles.option, { backgroundColor: choice === option ? theme.surfaceMuted : theme.surface, borderColor: choice === option ? theme.primary : theme.border }]}>
              <Body>{option}</Body>
            </Pressable>
          ))}
          <Button label="Check answer" disabled={!choice} onPress={() => void submit(choice === card.meaning ? "got-it" : "forgot")} />
        </>
      ) : null}
      {!recognition && !revealed ? <Button label="Reveal answer" onPress={() => setRevealed(true)} /> : null}
      {revealed || (recognition && attempt) ? (
        <Card style={{ backgroundColor: theme.surfaceMuted }}>
          <Body muted style={styles.small}>{recognition ? attempt?.rating === "got-it" ? "Correct" : "Correct meaning" : "Example answer"}</Body>
          <Heading>{recognition ? card.meaning : card.target}</Heading>
          {recognition && choice && choice !== card.meaning ? <Body muted>Your answer: {choice}</Body> : null}
          {card.audioPath ? <Button label={audio.label(card.audioPath)} variant="secondary" onPress={() => card.audioPath && void audio.play(card.audioPath)} /> : null}
        </Card>
      ) : null}
      {revealed && !attempt ? (
        <View style={styles.ratings}>
          <Heading>How did you do?</Heading>
          <Button label="Got it" onPress={() => void submit("got-it")} />
          <Button label="Almost" variant="secondary" onPress={() => void submit("almost")} />
          <Button label="Forgot" variant="ghost" onPress={() => void submit("forgot")} />
        </View>
      ) : null}
      {attempt && !saved ? (
        error ? (
          <>
            <Body muted>Couldn’t save your answer.</Body>
            <Button label="Retry save" onPress={() => void submit(attempt.rating)} />
            <Button label="Continue without saving" variant="secondary" onPress={() => onNext({ question, rating: attempt.rating })} />
          </>
        )
          : <Body muted accessibilityLiveRegion="polite">Saving your answer…</Body>
      ) : null}
      {saved ? <Button label={number === total ? "See recap" : "Next question"} onPress={() => onNext(saved)} /> : null}
    </>
  );
}

function ReviewRecap({ completed, onClose }: { completed: Reviewed[]; onClose: () => void }) {
  const theme = useTheme();
  const recall = completed.filter((entry) => entry.question.mode === "recall");
  const recognition = completed.filter((entry) => entry.question.mode === "recognition");
  const gotIt = (entries: Reviewed[]) => entries.filter((entry) => entry.rating === "got-it").length;
  const revisit = completed.filter((entry) => entry.rating !== "got-it");
  const scheduled = revisit.flatMap((entry) => entry.progress ? [{ ...entry, progress: entry.progress }] : []);
  const unsaved = completed.filter((entry) => !entry.progress).length;
  return (
    <>
      <Card style={{ backgroundColor: theme.mint, borderWidth: 0 }}>
        <Title style={{ color: theme.navy }}>{revisit.length ? "Keep these in rotation" : "Nice work"}</Title>
        {recall.length ? <Body style={{ color: theme.navy }}>Recalled {gotIt(recall)} of {recall.length} phrases</Body> : null}
        {recognition.length ? <Body style={{ color: theme.navy }}>Recognized {gotIt(recognition)} of {recognition.length} meanings</Body> : null}
      </Card>
      {gotIt(recall) ? (
        <Card>
          <Heading>Recalled in review</Heading>
          {recall.filter((entry) => entry.rating === "got-it").map(({ question }) => <Body key={question.card.id}>{question.card.target}</Body>)}
        </Card>
      ) : null}
      {unsaved ? <Body muted>Progress couldn’t sync for {unsaved} {unsaved === 1 ? "answer" : "answers"}.</Body> : null}
      {scheduled.length ? <Heading>Coming back sooner</Heading> : null}
      {scheduled.map(({ question, rating, progress }) => (
        <Card key={question.card.id}>
          <Heading>{question.card.target}</Heading>
          <Body muted>{question.card.meaning}</Body>
          <Body style={styles.small}>{question.mode === "recognition" ? "Recognition" : labels[rating]} · In {progress.intervalDays} {progress.intervalDays === 1 ? "day" : "days"}</Body>
        </Card>
      ))}
      <Button label="Done" onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingVertical: 8 },
  headerTitle: { flex: 1 },
  headerClose: { minHeight: 44, justifyContent: "center", paddingLeft: 16 },
  content: { padding: 20, gap: 14 },
  questionMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  progressDots: { flexDirection: "row", gap: 4 },
  progressDot: { width: 14, height: 4, borderRadius: 2 },
  questionTitle: { fontSize: 25, lineHeight: 31 },
  prompt: { fontSize: 23, lineHeight: 29 },
  small: { fontSize: 13, lineHeight: 19 },
  option: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderRadius: 14 },
  ratings: { gap: 7 },
});
