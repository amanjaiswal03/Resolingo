import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from "expo-audio";
import type { Lesson } from "@resolingo/shared";
import { Button } from "./Button";
import { Body, Heading } from "./Typography";
import { useTheme } from "@/theme/tokens";

const speeds = [0.8, 1, 1.2] as const;

export function LessonPlayer({ lesson, onComplete, onStart, onSegmentChange }: {
  lesson: Lesson;
  onComplete: () => void;
  onStart?: () => void;
  onSegmentChange?: (segmentId: string) => void;
}) {
  const theme = useTheme();
  const playable = useMemo(() => lesson.segments.filter((segment) => segment.audioUrl), [lesson.segments]);
  const [index, setIndex] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(1);
  const started = useRef(false);
  const player = useAudioPlayer(null, { updateInterval: 250, preferredForwardBufferDuration: 10 });
  const status = useAudioPlayerStatus(player);
  const current = playable[index];

  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }); }, []);
  useEffect(() => {
    if (current) onSegmentChange?.(current.id);
  }, [current, onSegmentChange]);
  useEffect(() => {
    if (!current?.audioUrl) return;
    player.replace({ uri: current.audioUrl, name: lesson.title });
    player.setPlaybackRate(speeds[speedIndex]!);
    player.setActiveForLockScreen(true, { title: lesson.title, artist: "Resolingo", albumTitle: lesson.type === "grammar" ? "Grammar lesson" : "Conversation lesson" });
    player.play();
    if (!started.current) {
      started.current = true;
      onStart?.();
    }
  // Changing speed is handled imperatively so it does not restart the segment.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.audioUrl, lesson.title, lesson.type, onStart, player]);
  useEffect(() => {
    const subscription = player.addListener("playbackStatusUpdate", (nextStatus) => {
      if (!nextStatus.didJustFinish) return;
      if (index < playable.length - 1) setIndex((value) => value + 1);
      else { player.setActiveForLockScreen(false); onComplete(); }
    });
    return () => subscription.remove();
  }, [index, onComplete, playable.length, player]);
  useEffect(() => () => { player.setActiveForLockScreen(false); }, [player]);

  const changeSpeed = () => {
    const next = (speedIndex + 1) % speeds.length;
    setSpeedIndex(next); player.setPlaybackRate(speeds[next]!);
  };
  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  return (
    <View style={[styles.player, { backgroundColor: theme.navy }]}>
      <View style={styles.now}><Body style={styles.kicker}>NOW PLAYING · {index + 1}/{playable.length}</Body><Heading style={styles.title}>{current?.speaker === "teacher" ? "Resolingo teacher" : current?.speaker === "speakerA" ? "Speaker A" : "Speaker B"}</Heading><Body style={styles.transcript}>{current?.text}</Body>{current?.translation ? <Body style={styles.translation}>{current.translation}</Body> : null}</View>
      <View style={[styles.track, { backgroundColor: "#314262" }]}><View style={[styles.fill, { backgroundColor: theme.coral, width: `${progress * 100}%` }]} /></View>
      <View style={styles.controls}>
        <Button label={`${speeds[speedIndex]}×`} variant="ghost" onPress={changeSpeed} />
        <Pressable accessibilityRole="button" accessibilityLabel="Back ten seconds" onPress={() => void player.seekTo(Math.max(0, status.currentTime - 10))} style={styles.circle}><Body style={styles.controlText}>−10</Body></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? "Pause" : "Play"} onPress={() => status.playing ? player.pause() : player.play()} style={[styles.play, { backgroundColor: theme.coral }]}><Body style={styles.playText}>{status.playing ? "Ⅱ" : "▶"}</Body></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Forward ten seconds" onPress={() => void player.seekTo(Math.min(status.duration, status.currentTime + 10))} style={styles.circle}><Body style={styles.controlText}>+10</Body></Pressable>
        <Button label="Next" variant="ghost" disabled={index >= playable.length - 1} onPress={() => setIndex((value) => Math.min(playable.length - 1, value + 1))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  player: { borderRadius: 26, padding: 20, gap: 18 }, now: { minHeight: 190, gap: 9, justifyContent: "center" }, kicker: { color: "#9FB0CC", fontSize: 11, fontWeight: "800", letterSpacing: 1.3 }, title: { color: "#FFFFFF" }, transcript: { color: "#FFFFFF", fontSize: 21, lineHeight: 30 }, translation: { color: "#BAC7DD" }, track: { height: 6, borderRadius: 3, overflow: "hidden" }, fill: { height: 6, borderRadius: 3 }, controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, circle: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, play: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center" }, controlText: { color: "#FFFFFF", fontWeight: "700" }, playText: { color: "#08152F", fontSize: 20, fontWeight: "800" },
});
