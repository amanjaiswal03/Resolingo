import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { File } from "expo-file-system";
import { languageById, MAX_PHRASE_AUDIO_SECONDS, type Phrase } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { HOW_WOULD_YOU_SAY_ENABLED } from "@/features";
import { api } from "@/services/api";
import { subscribePhrases } from "@/services/phrases";
import { SPEECH_RECORDING } from "@/say/speech-recording";
import { initialVoiceActivity, stepVoiceActivity, type VadStop } from "@/say/voice-activity";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message.replace(/^\[.*?\]\s*/, "");
  }
  return "Please try again.";
}

function discard(uri: string | null) {
  if (!uri) return;
  try { new File(uri).delete(); } catch { /* the recording is already gone */ }
}

function clock(millis: number): string {
  const seconds = Math.min(MAX_PHRASE_AUDIO_SECONDS, Math.max(0, Math.round(millis / 1000)));
  return `0:${String(seconds).padStart(2, "0")}`;
}

function levelRatio(db: number | undefined): number {
  if (db == null || !Number.isFinite(db)) return 0.12;
  const floor = -60;
  const clamped = Math.min(0, Math.max(floor, db));
  return (clamped - floor) / (0 - floor);
}

type Phase = "idle" | "listening" | "transcribing";

export default function SayScreen() {
  if (!HOW_WOULD_YOU_SAY_ENABLED) return <HiddenSay />;
  return <SayLookup />;
}

function HiddenSay() {
  const router = useRouter();
  useEffect(() => { router.replace("/(tabs)"); }, [router]);
  return null;
}

function SayLookup() {
  const { user, profile } = useSession();
  const router = useRouter();
  const theme = useTheme();
  const [text, setText] = useState("");
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const finishing = useRef(false);
  const cancelRequested = useRef(false);
  const sawRecording = useRef(false);
  const activity = useRef(initialVoiceActivity());
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorder = useAudioRecorder(SPEECH_RECORDING);
  const recording = useAudioRecorderState(recorder, 200);

  const setPhaseBoth = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const stopPoll = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  };

  const finishRecording = async (reason: "user" | "cancel" | VadStop) => {
    if (finishing.current || phaseRef.current !== "listening") return;
    finishing.current = true;
    const cancelled = reason === "cancel" || cancelRequested.current;
    const heardSpeech = activity.current.heardSpeech;
    const sawLevel = activity.current.sawLevel;
    const durationMs = Math.min(MAX_PHRASE_AUDIO_SECONDS * 1000, Math.round(recorder.getStatus().durationMillis || 0));
    const missed = !cancelled && (reason === "no-speech" || (sawLevel && !heardSpeech));
    setPhaseBoth(cancelled || missed ? "idle" : "transcribing");
    let uri = recorder.uri ?? recorder.getStatus().url;
    try {
      await recorder.stop().catch(() => undefined);
      uri = recorder.uri ?? recorder.getStatus().url ?? uri;
      if (cancelled) {
        discard(uri);
        return;
      }
      if (!uri || missed || durationMs < 300) {
        discard(uri);
        Alert.alert("Didn't catch that", "Try saying the sentence again.");
        return;
      }
      const audioBase64 = await new File(uri).base64();
      discard(uri);
      const result = await api.transcribePhrase({ audioBase64, mimeType: "audio/m4a", durationMs });
      setText(result.nativeText.slice(0, 280));
    } catch (error) {
      discard(uri);
      if (!cancelled) Alert.alert("Didn't catch that", messageOf(error));
    } finally {
      stopPoll();
      finishing.current = false;
      cancelRequested.current = false;
      sawRecording.current = false;
      activity.current = initialVoiceActivity();
      setPhaseBoth("idle");
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    }
  };

  useEffect(() => {
    if (!user) return;
    return subscribePhrases(user.uid, setPhrases);
  }, [user]);

  useEffect(() => () => {
    if (poll.current) clearInterval(poll.current);
    if (phaseRef.current === "listening") void recorder.stop().catch(() => undefined);
  }, [recorder]);

  const startRecording = async () => {
    if (phaseRef.current !== "idle" || submitting) return;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Microphone is off",
          "Resolingo uses the microphone so you can say a sentence in your language and get it translated.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Open Settings", onPress: () => { void Linking.openSettings(); } },
          ],
        );
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      sawRecording.current = false;
      cancelRequested.current = false;
      activity.current = initialVoiceActivity();
      setPhaseBoth("listening");
      recorder.record({ forDuration: MAX_PHRASE_AUDIO_SECONDS });
      stopPoll();
      poll.current = setInterval(() => {
        if (phaseRef.current !== "listening" || finishing.current) return;
        const status = recorder.getStatus();
        if (status.isRecording) sawRecording.current = true;
        const stepped = stepVoiceActivity(activity.current, {
          durationMs: status.durationMillis,
          meteringDb: typeof status.metering === "number" ? status.metering : null,
          capMs: MAX_PHRASE_AUDIO_SECONDS * 1000,
        });
        activity.current = stepped.state;
        if (stepped.stop) {
          void finishRecording(stepped.stop);
          return;
        }
        if (sawRecording.current && !status.isRecording) void finishRecording(activity.current.heardSpeech ? "cap" : "no-speech");
      }, 200);
    } catch (error) {
      stopPoll();
      setPhaseBoth("idle");
      await recorder.stop().catch(() => undefined);
      Alert.alert("Couldn't use the microphone", messageOf(error));
    }
  };

  const cancelRecording = () => {
    cancelRequested.current = true;
    void finishRecording("cancel");
  };

  const submit = async () => {
    const query = text.trim();
    if (!query || submitting || phase !== "idle") return;
    setSubmitting(true);
    try {
      const result = await api.translatePhrase(query);
      router.push(`/say/${result.phraseId}`);
    } catch (error) {
      Alert.alert("Couldn’t translate that", messageOf(error));
    } finally {
      setSubmitting(false);
    }
  };

  const listening = phase === "listening";
  const busy = phase !== "idle" || submitting;
  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}><Body muted>Back</Body></Pressable>
      <View style={styles.header}>
        <Title>How would you say?</Title>
        <Body muted>Type a sentence, or tap the microphone and say it. You’ll hear it in {profile ? languageById[profile.targetLanguage].label : "your target language"}, then you can make a short lesson. You can edit the words before translating.</Body>
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        editable={!busy}
        maxLength={280}
        placeholder="I need to buy a pair of shoes."
        placeholderTextColor={theme.textMuted}
        style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
      />
      <View style={styles.micRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={listening ? "Stop recording" : "Start recording"}
          disabled={phase === "transcribing" || submitting}
          onPress={() => { if (listening) void finishRecording("user"); else void startRecording(); }}
          style={({ pressed }) => [styles.mic, { backgroundColor: listening ? theme.danger : theme.primary, opacity: phase === "transcribing" || submitting ? 0.5 : pressed ? 0.75 : 1 }]}
        >
          <Body style={{ color: listening ? theme.background : theme.onPrimary }}>{listening ? "Stop" : "Speak"}</Body>
        </Pressable>
        <View style={styles.micCopy}>
          {listening ? <Body>Listening… {clock(recording.durationMillis)}</Body> : null}
          {listening ? (
            <View accessibilityElementsHidden style={styles.level}>
              {[0.55, 0.8, 1, 0.8, 0.55].map((shape, index) => (
                <View key={index} style={[styles.levelBar, { backgroundColor: theme.primary, height: 6 + levelRatio(recording.metering) * 22 * shape }]} />
              ))}
            </View>
          ) : null}
          {phase === "transcribing" ? <Body>Transcribing…</Body> : null}
          {phase === "idle" ? <Body muted>It stops when you pause. You can also tap Stop. Up to {MAX_PHRASE_AUDIO_SECONDS} seconds.</Body> : null}
          {listening ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel recording" onPress={cancelRecording}>
              <Body muted>Cancel</Body>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Button label={submitting ? "Translating…" : "Translate"} loading={submitting} disabled={text.trim().length === 0 || busy} onPress={() => void submit()} />
      <Heading>Past phrases</Heading>
      {phrases.length === 0 ? <Body muted>Your phrases will show up here.</Body> : phrases.map((phrase) => (
        <Pressable key={phrase.id} accessibilityRole="button" accessibilityLabel={phrase.nativeText} onPress={() => router.push(`/say/${phrase.id}`)}>
          <Card>
            <Body>{phrase.nativeText}</Body>
            <Body muted>{phrase.translation}</Body>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 8 },
  input: { minHeight: 120, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, textAlignVertical: "top" },
  micRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  mic: { minHeight: 52, minWidth: 88, borderRadius: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  micCopy: { flex: 1, gap: 4 },
  level: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 28 },
  levelBar: { width: 5, borderRadius: 3 },
});
