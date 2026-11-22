import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AnswerPlan, PracticePrompt } from "@/lesson/answer-windows";
import { phraseMatch, type PhraseMatch, type VoiceResult } from "@/lesson/phrase-match";
import { useTheme } from "@/theme/tokens";
import { Card } from "./Card";
import { Body, Heading, Title } from "./Typography";

type PracticeRow = PracticePrompt & PhraseMatch;
const feedback = {
  retry: { label: "Try again", color: "coral", order: 0, tip: "Listen to the model slowly, then say it in short pieces." },
  close: { label: "Close match", color: "amber", order: 1, tip: "Compare the two lines and try the full phrase once more." },
  unclear: { label: "Couldn’t check", color: "surfaceMuted", order: 2, tip: "Try saying the phrase again somewhere quieter." },
  skipped: { label: "Skipped", color: "surfaceMuted", order: 3, tip: "" },
  matched: { label: "Matched", color: "successFill", order: 4, tip: "" },
  checking: { label: "Checking…", color: "surfaceMuted", order: 5, tip: "" },
} as const;

type Props = {
  plan: AnswerPlan;
  state: "off" | "starting" | "on";
  available: boolean;
  recording: boolean;
  results: Record<string, VoiceResult>;
  onToggle: () => void;
  onPauseLesson: () => void;
  onPlayInLesson: (segmentId: string) => void;
  onRetry: (segmentId: string, onReady: () => void) => void;
};

export function SpeakingPractice({ plan, state, available, recording, results, onToggle, onPauseLesson, onPlayInLesson, onRetry }: Props) {
  const theme = useTheme();
  const [showRecap, setShowRecap] = useState(false);
  const rows = useMemo(() => plan.windows.flatMap((prompt) => {
    const result = results[prompt.id];
    return result ? [{ ...prompt, ...phraseMatch(prompt.expected, result, plan.language) }] : [];
  }).sort((left, right) => feedback[left.level].order - feedback[right.level].order), [plan, results]);
  const enabled = state === "on";
  const starting = state === "starting";
  const close = () => setShowRecap(false);

  return (
    <View style={[styles.practiceBar, { backgroundColor: theme.surfaceMuted }]}>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Check my answers"
        accessibilityState={{ checked: enabled, disabled: starting || !available, busy: starting }}
        disabled={starting || !available}
        onPress={onToggle}
        style={styles.practiceToggle}
      >
        <View style={[styles.stateDot, { backgroundColor: recording ? theme.brand : enabled ? theme.primary : theme.textMuted }]} />
        <View style={styles.practiceText}>
          <Body style={styles.controlLabel}>Check my answers</Body>
          <Body muted style={styles.small}>
            {recording ? "Listening now" : enabled ? "On · Speak at the tone" : starting ? "Setting up speech…" : "Off · Optional speaking practice"}
          </Body>
        </View>
      </Pressable>
      {rows.length ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Review ${rows.length} speaking prompts`} onPress={() => setShowRecap(true)} style={styles.reviewButton}>
          <Body style={[styles.controlLabel, { color: theme.primary }]}>Review</Body>
        </Pressable>
      ) : null}
      <Modal visible={showRecap} animationType="slide" presentationStyle="pageSheet" backdropColor={theme.background} onRequestClose={close}>
        {/* Modal keeps its children mounted until the iOS dismissal animation ends. */}
        <SpeakingRecap
          rows={rows}
          onClose={close}
          onPauseLesson={onPauseLesson}
          onPlayInLesson={(id) => { close(); onPlayInLesson(id); }}
          onRetry={available && !starting ? onRetry : undefined}
        />
      </Modal>
    </View>
  );
}

function SpeakingRecap({ rows, onClose, onPauseLesson, onPlayInLesson, onRetry }: {
  rows: PracticeRow[];
  onClose: () => void;
  onPauseLesson: () => void;
  onPlayInLesson: (id: string) => void;
  onRetry: Props["onRetry"] | undefined;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const preview = useAudioPlayer(null, { keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(preview);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const matched = rows.filter((row) => row.level === "matched").length;
  const toPractice = rows.filter((row) => row.level === "close" || row.level === "retry").length;
  const skipped = rows.filter((row) => row.level === "skipped").length;
  const unclear = rows.filter((row) => row.level === "unclear").length;
  const stats = [
    { label: "Matched", count: matched },
    { label: "To practice", count: toPractice },
    { label: "Unclear", count: unclear },
    { label: "Skipped", count: skipped },
  ];

  const listen = (row: PracticeRow) => {
    if (!row.modelAudioUrl) {
      preview.pause();
      onPlayInLesson(row.answerId);
      return;
    }
    if (status.playing && previewId === row.id) {
      preview.pause();
      return;
    }
    onPauseLesson();
    setPreviewId(row.id);
    preview.replace({ uri: row.modelAudioUrl });
    preview.setPlaybackRate(0.8);
    preview.play();
  };
  const close = () => {
    preview.pause();
    onClose();
  };

  return (
    <View style={[styles.sheet, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Title accessibilityRole="header" style={styles.sheetTitle}>Speaking recap</Title>
        <Pressable accessibilityRole="button" onPress={close} style={styles.done}>
          <Body style={[styles.controlLabel, { color: theme.primary }]}>Done</Body>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.recapContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={[styles.summary, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          {stats.map(({ label, count }, index) => (
            <View key={label} style={[styles.stat, index > 0 && styles.statDivider, { borderColor: theme.border }]}>
              <Heading>{count}</Heading>
              <Body muted style={styles.small}>{label}</Body>
            </View>
          ))}
        </View>
        <Body muted style={styles.explainer}>Phrase match compares the words we heard with the lesson example. Use the audio to practice how they sound.</Body>
        {rows.map((row) => {
          const info = feedback[row.level];
          const previewing = status.playing && previewId === row.id;
          return (
            <Card key={row.id} style={styles.resultCard}>
              <View style={[styles.badge, { backgroundColor: theme[info.color] }]}>
                <Body style={[styles.badgeLabel, { color: info.color === "surfaceMuted" ? theme.text : theme.navy }]}>{info.label}</Body>
              </View>
              <View>
                <Heading style={styles.model}>{row.expected}</Heading>
                {row.translation ? <Body muted style={styles.explainer}>{row.translation}</Body> : null}
              </View>
              {row.heard && row.level !== "matched" && row.level !== "checking" && row.level !== "skipped" ? (
                <View style={[styles.heard, { backgroundColor: theme.surfaceMuted }]}>
                  <Body muted style={styles.small}>We heard</Body>
                  <Body style={styles.recognized}>{row.heard}</Body>
                  {row.detail ? <Body muted style={styles.small}>{row.detail}</Body> : null}
                </View>
              ) : null}
              {info.tip ? <Body muted style={styles.explainer}>{info.tip}</Body> : null}
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" onPress={() => listen(row)} style={[styles.listen, { borderColor: theme.border }]}>
                  <Body style={[styles.controlLabel, { color: theme.primary }]}>
                    {previewing ? "Pause example" : row.modelAudioUrl ? "Listen slowly" : "Hear it in the lesson"}
                  </Body>
                </Pressable>
                {onRetry && row.level !== "matched" && row.level !== "checking" ? (
                  <Pressable accessibilityRole="button" onPress={() => { preview.pause(); onRetry(row.id, onClose); }} style={[styles.listen, { borderColor: theme.border }]}>
                    <Body style={styles.controlLabel}>Retry aloud</Body>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  practiceBar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", borderRadius: 15, paddingHorizontal: 12, columnGap: 8 },
  practiceToggle: { flex: 1, minHeight: 53, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  practiceText: { flex: 1 },
  stateDot: { width: 8, height: 8, borderRadius: 4 },
  small: { fontSize: 12, lineHeight: 17 },
  controlLabel: { fontSize: 14, lineHeight: 21, fontWeight: "700" },
  reviewButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 22, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { flex: 1, fontSize: 27, lineHeight: 34 },
  done: { minHeight: 44, justifyContent: "center", paddingLeft: 16 },
  recapContent: { padding: 20, gap: 14 },
  summary: { flexDirection: "row", alignItems: "stretch", paddingVertical: 13, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20 },
  stat: { flex: 1, alignItems: "center", paddingHorizontal: 5 },
  statDivider: { borderLeftWidth: StyleSheet.hairlineWidth },
  explainer: { fontSize: 14, lineHeight: 21 },
  resultCard: { gap: 11 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeLabel: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  model: { fontSize: 20, lineHeight: 26 },
  heard: { padding: 11, borderRadius: 12, gap: 2 },
  recognized: { fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  listen: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
});
