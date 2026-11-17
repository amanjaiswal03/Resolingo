import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { File } from "expo-file-system";
import { MAX_PHRASE_AUDIO_SECONDS, type Phrase } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { api } from "@/services/api";
import { subscribePhrases } from "@/services/phrases";
import { SPEECH_RECORDING } from "@/say/speech-recording";
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

type Phase = "idle" | "listening" | "transcribing";

export default function SayScreen() {
  const { user } = useSession();
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

  const finishRecording = async () => {
    if (finishing.current || phaseRef.current !== "listening") return;
    finishing.current = true;
    const cancelled = cancelRequested.current;
    const durationMs = Math.min(MAX_PHRASE_AUDIO_SECONDS * 1000, Math.round(recorder.getStatus().durationMillis || 0));
    setPhaseBoth(cancelled ? "idle" : "transcribing");
    let uri = recorder.uri ?? recorder.getStatus().url;
    try {
      await recorder.stop().catch(() => undefined);
      uri = recorder.uri ?? recorder.getStatus().url ?? uri;
      if (!uri) {
        if (!cancelled) Alert.alert("Didn't catch that", "Try saying the sentence again.");
        return;
      }
      if (cancelled) {
        discard(uri);
        return;
      }
      if (durationMs < 300) {
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
      setPhaseBoth("listening");
      recorder.record({ forDuration: MAX_PHRASE_AUDIO_SECONDS });
      stopPoll();
      poll.current = setInterval(() => {
        if (phaseRef.current !== "listening" || finishing.current) return;
        const status = recorder.getStatus();
        if (status.isRecording) sawRecording.current = true;
        const capped = status.durationMillis >= MAX_PHRASE_AUDIO_SECONDS * 1000;
        if (capped || (sawRecording.current && !status.isRecording)) void finishRecording();
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
    void finishRecording();
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
        <Body muted>Type a sentence, or tap the microphone and say it. You can edit the words before translating.</Body>
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        editable={!busy}
        maxLength={280}
        placeholder="How would you say I need to buy a pair of shoes?"
        placeholderTextColor={theme.textMuted}
        style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
      />
      <View style={styles.micRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={listening ? "Stop recording" : "Start recording"}
          disabled={phase === "transcribing" || submitting}
          onPress={() => { if (listening) void finishRecording(); else void startRecording(); }}
          style={({ pressed }) => [styles.mic, { backgroundColor: listening ? theme.danger : theme.primary, opacity: phase === "transcribing" || submitting ? 0.5 : pressed ? 0.75 : 1 }]}
        >
          <Body style={{ color: listening ? theme.background : theme.onPrimary }}>{listening ? "Stop" : "Speak"}</Body>
        </Pressable>
        <View style={styles.micCopy}>
          {listening ? <Body>Listening… {clock(recording.durationMillis)}</Body> : null}
          {phase === "transcribing" ? <Body>Transcribing…</Body> : null}
          {phase === "idle" ? <Body muted>Up to {MAX_PHRASE_AUDIO_SECONDS} seconds. Tap again to stop.</Body> : null}
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
});
