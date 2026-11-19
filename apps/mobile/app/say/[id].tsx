import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Crypto from "expo-crypto";
import { languageById, phraseLessonControl, type Lesson, type Phrase } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { firstRouteParam } from "@/lesson/navigation";
import { usePlayback } from "@/playback/PlaybackProvider";
import { api } from "@/services/api";
import { subscribeLesson } from "@/services/lessons";
import { phraseAudioUrl, subscribePhrase } from "@/services/phrases";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message.replace(/^\[.*?\]\s*/, "");
  }
  return "Please try again.";
}

export default function PhraseScreen() {
  const phraseId = firstRouteParam(useLocalSearchParams<{ id?: string | string[] }>().id);
  const { user } = useSession();
  const { open } = usePlayback();
  const router = useRouter();
  const theme = useTheme();
  const [phrase, setPhrase] = useState<Phrase | null>(null);
  const [linkedLesson, setLinkedLesson] = useState<{ id: string; lesson: Lesson | null } | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const player = useRef<AudioPlayer | null>(null);
  const autoplayed = useRef<string | null>(null);
  useEffect(() => () => { player.current?.remove(); }, []);
  useEffect(() => {
    if (!user || !phraseId) return;
    return subscribePhrase(user.uid, phraseId, (next) => {
      setPhrase(next);
      setReady(true);
    }, () => setReady(true));
  }, [user, phraseId]);
  useEffect(() => {
    if (!user || !phrase?.lessonId) return;
    const id = phrase.lessonId;
    return subscribeLesson(user.uid, id, (next) => {
      setLinkedLesson({ id, lesson: next });
    }, () => setLinkedLesson({ id, lesson: null }));
  }, [user, phrase?.lessonId]);
  const nativeDraft = phrase && draftFor === phrase.id ? draft : (phrase?.nativeText ?? "");
  const play = useCallback(async () => {
    if (!phrase?.audioPath || playing) return;
    setPlaying(true);
    try {
      const url = await phraseAudioUrl(phrase.audioPath);
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "doNotMix" });
      player.current?.remove();
      const next = createAudioPlayer({ uri: url });
      player.current = next;
      next.play();
    } catch (error) {
      Alert.alert("Couldn’t play that", messageOf(error));
    } finally {
      setPlaying(false);
    }
  }, [phrase, playing]);
  useEffect(() => {
    if (!phrase?.audioPath || autoplayed.current === phrase.audioPath) return;
    autoplayed.current = phrase.audioPath;
    void play();
  }, [phrase?.audioPath, play]);
  const translateAgain = async () => {
    const query = nativeDraft.trim();
    if (!query || translating) return;
    setTranslating(true);
    try {
      const result = await api.translatePhrase(query);
      if (result.phraseId !== phraseId) router.replace(`/say/${result.phraseId}`);
    } catch (error) {
      Alert.alert("Couldn’t translate that", messageOf(error));
    } finally {
      setTranslating(false);
    }
  };
  const linked = phrase?.lessonId && linkedLesson?.id === phrase.lessonId ? linkedLesson.lesson : undefined;
  const control = phrase?.lessonId && linked === undefined ? "generating" : phraseLessonControl(linked?.status ?? null);
  const openLesson = () => {
    const id = linked?.id ?? phrase?.lessonId;
    if (!id) return;
    if (linked?.status === "ready") open(id, { expand: true });
    else router.push(`/lesson/${id}`);
  };
  const createLesson = async () => {
    if (!phrase || creating || control !== "create") return;
    setCreating(true);
    try {
      const result = await api.createPhraseLesson(phrase.id, Crypto.randomUUID());
      router.push(`/lesson/${result.lessonId}`);
    } catch (error) {
      Alert.alert("Couldn’t create a lesson", messageOf(error));
    } finally {
      setCreating(false);
    }
  };
  const retryLesson = async () => {
    const id = linked?.id ?? phrase?.lessonId;
    if (!id || creating) return;
    setCreating(true);
    try {
      await api.retryFailedLesson(id);
      router.push(`/lesson/${id}`);
    } catch (error) {
      Alert.alert("Couldn’t retry", messageOf(error));
    } finally {
      setCreating(false);
    }
  };
  if (!ready) return <LoadingScreen />;
  if (!phrase) {
    return (
      <Screen>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}><Body muted>Back</Body></Pressable>
        <Title>Phrase not found</Title>
        <Body muted>Translate a sentence and it will show up here.</Body>
      </Screen>
    );
  }
  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}><Body muted>Back</Body></Pressable>
      <View style={styles.header}><Heading>Edit it if this isn’t what you meant.</Heading></View>
      <TextInput
        value={nativeDraft}
        onChangeText={(value) => { setDraft(value); setDraftFor(phrase.id); }}
        multiline
        maxLength={280}
        style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
      />
      <Button label={translating ? "Translating…" : "Translate again"} variant="secondary" loading={translating} onPress={() => void translateAgain()} />
      <Card>
        <Body muted>In {languageById[phrase.targetLanguage].label}</Body>
        <Title style={styles.translation}>{phrase.translation}</Title>
        {phrase.transliteration ? <Body muted>{phrase.transliteration}</Body> : null}
        {phrase.note ? <Body muted>{phrase.note}</Body> : null}
      </Card>
      {phrase.alternatives.length > 0 ? (
        <View style={styles.alternatives}>
          <Heading>Other ways to say it</Heading>
          {phrase.alternatives.map((alternative) => (
            <Card key={`${alternative.label}:${alternative.text}`}>
              <Body muted>{alternative.label}</Body>
              <Body>{alternative.text}</Body>
              {alternative.transliteration ? <Body muted>{alternative.transliteration}</Body> : null}
            </Card>
          ))}
        </View>
      ) : null}
      <Button label={playing ? "Playing…" : "Play"} variant="secondary" loading={playing} disabled={!phrase.audioPath} onPress={() => void play()} />
      {control === "play" ? <Button label="Play lesson" onPress={openLesson} /> : null}
      {control === "generating" ? <Button label="Creating your lesson…" disabled /> : null}
      {control === "retry" ? <Button label={creating ? "Trying again…" : "Try again"} loading={creating} onPress={() => void retryLesson()} /> : null}
      {control === "create" ? <Button label={creating ? "Creating your lesson…" : "Create a lesson"} loading={creating} onPress={() => void createLesson()} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4 },
  input: { minHeight: 88, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, textAlignVertical: "top" },
  translation: { fontSize: 28, lineHeight: 34 },
  alternatives: { gap: 10 },
});
