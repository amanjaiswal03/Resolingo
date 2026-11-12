import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { createAudioPlaylist, setAudioModeAsync, useAudioPlaylistStatus } from "expo-audio";
import { lessonDisplayText, type Lesson, type LessonSegment } from "@resolingo/shared";
import { percentWidth } from "@/lesson/navigation";
import { stopOwnedPlaylist } from "@/lesson/player-lifecycle";
import { elapsedMs, lessonTimeline, seekInTimeline } from "@/lesson/timeline";
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
  const playable = useMemo(() => lesson.segments.filter((segment): segment is LessonSegment & { audioUrl: string } => Boolean(segment.audioUrl)), [lesson.segments]);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [measuredMs, setMeasuredMs] = useState<Record<number, number>>({});
  const started = useRef(false);
  const completed = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  // Owned outside useAudioPlaylist so we can pause before destroy(). That hook
  // releases in its own effect, which runs before later cleanups and crashes
  // iOS on the way back to home.
  const [playlist] = useState(() => createAudioPlaylist({
    sources: playable.map((segment) => ({ uri: segment.audioUrl, name: lesson.title })),
    updateInterval: 250,
    loop: "none",
  }));
  const status = useAudioPlaylistStatus(playlist);
  const timeline = useMemo(() => lessonTimeline(playable.map((segment, index) => {
    const durationMs = measuredMs[index] ?? segment.durationMs;
    return durationMs ? { durationMs } : {};
  })), [measuredMs, playable]);
  const current = playable[status.currentIndex] ?? playable[0];

  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }); }, []);
  useEffect(() => {
    if (!alive.current || playable.length === 0) return;
    playlist.playbackRate = 1;
    playlist.play();
    if (!started.current) {
      started.current = true;
      onStartRef.current?.();
    }
  }, [playlist, playable.length]);
  useEffect(() => {
    if (current) onSegmentChange?.(current.id);
  }, [current, onSegmentChange]);
  useEffect(() => {
    if (!status.isLoaded || status.duration <= 0) return;
    const durationMs = Math.round(status.duration * 1_000);
    setMeasuredMs((currentMs) => currentMs[status.currentIndex] === durationMs ? currentMs : { ...currentMs, [status.currentIndex]: durationMs });
  }, [status.currentIndex, status.duration, status.isLoaded]);
  useEffect(() => {
    if (!alive.current || !status.didJustFinish || status.currentIndex < playable.length - 1 || completed.current) return;
    completed.current = true;
    onComplete();
  }, [onComplete, playable.length, status.currentIndex, status.didJustFinish]);
  useEffect(() => {
    const currentGeneration = ++generation.current;
    return () => {
      queueMicrotask(() => {
        // Reading the ref here is intentional: it changes when the effect re-runs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (generation.current !== currentGeneration) return;
        stopOwnedPlaylist(playlist);
      });
    };
  }, [playlist]);

  const changeSpeed = () => {
    const next = (speedIndex + 1) % speeds.length;
    setSpeedIndex(next);
    playlist.playbackRate = speeds[next]!;
  };
  const seekBy = (deltaSec: number) => {
    const index = status.currentIndex;
    const clipDuration = status.duration > 0 ? status.duration : (timeline.durationsMs[index] ?? 0) / 1_000;
    const nextTime = status.currentTime + deltaSec;
    if (nextTime >= 0 && nextTime <= clipDuration) {
      void playlist.seekTo(nextTime);
      return;
    }
    const target = seekInTimeline(timeline, elapsedMs(timeline, index, status.currentTime) + deltaSec * 1_000);
    if (target.index !== index) playlist.skipTo(target.index);
    if (target.offsetSec > 0.05) void playlist.seekTo(target.offsetSec);
  };
  const elapsed = elapsedMs(timeline, status.currentIndex, status.currentTime);
  const progress = timeline.totalMs > 0 ? Math.min(1, elapsed / timeline.totalMs) : 0;
  const transcript = current ? lessonDisplayText(current.text) : "";
  return (
    <View style={[styles.player, { backgroundColor: theme.navy }]}>
      <View style={styles.now}><Body style={styles.kicker}>NOW PLAYING</Body><Heading style={styles.title}>{current?.speaker === "teacher" ? "Resolingo teacher" : current?.speaker === "speakerA" ? "Speaker A" : "Speaker B"}</Heading><Body style={styles.transcript}>{transcript}</Body>{current?.translation ? <Body style={styles.translation}>{current.translation}</Body> : null}</View>
      <View style={[styles.track, { backgroundColor: "#314262" }]}><View style={[styles.fill, { backgroundColor: theme.coral, width: percentWidth(progress * 100) }]} /></View>
      <View style={styles.controls}>
        <Button label={`${speeds[speedIndex]}×`} variant="ghost" onPress={changeSpeed} />
        <Pressable accessibilityRole="button" accessibilityLabel="Back ten seconds" onPress={() => seekBy(-10)} style={styles.circle}><Body style={styles.controlText}>−10</Body></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? "Pause" : "Play"} onPress={() => status.playing ? playlist.pause() : playlist.play()} style={[styles.play, { backgroundColor: theme.coral }]}><Body style={styles.playText}>{status.playing ? "Ⅱ" : "▶"}</Body></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Forward ten seconds" onPress={() => seekBy(10)} style={styles.circle}><Body style={styles.controlText}>+10</Body></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  player: { borderRadius: 26, padding: 20, gap: 18 }, now: { minHeight: 190, gap: 9, justifyContent: "center" }, kicker: { color: "#9FB0CC", fontSize: 11, fontWeight: "800", letterSpacing: 1.3 }, title: { color: "#FFFFFF" }, transcript: { color: "#FFFFFF", fontSize: 21, lineHeight: 30 }, translation: { color: "#BAC7DD" }, track: { height: 6, borderRadius: 3, overflow: "hidden" }, fill: { height: 6, borderRadius: 3 }, controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, circle: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, play: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center" }, controlText: { color: "#FFFFFF", fontWeight: "700" }, playText: { color: "#08152F", fontSize: 20, fontWeight: "800" },
});
