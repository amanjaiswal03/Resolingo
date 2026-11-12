import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { createAudioPlayer, setAudioModeAsync, useAudioPlayerStatus } from "expo-audio";
import { lessonDisplayText, type Lesson } from "@resolingo/shared";
import { armAdvance, playbackPlan, resumeAction } from "@/lesson/autoplay";
import { percentWidth } from "@/lesson/navigation";
import { stopOwnedPlayer } from "@/lesson/player-lifecycle";
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
  const alive = useRef(true);
  const autoplay = useRef(true);
  const clipFinished = useRef(false);
  const playedThisClip = useRef(false);
  const cancelAdvance = useRef<(() => void) | null>(null);
  // Owned outside useAudioPlayer so we can pause and detach listeners before
  // release(). That hook releases in its own effect, which runs before any
  // cleanup declared after it and crashes iOS on the way back to home.
  const [player] = useState(() => createAudioPlayer(null, { updateInterval: 250, preferredForwardBufferDuration: 10 }));
  const status = useAudioPlayerStatus(player);
  const current = playable[index];
  const generation = useRef(0);
  const indexRef = useRef(index);
  const playableRef = useRef(playable);

  const stopAdvance = () => {
    cancelAdvance.current?.();
    cancelAdvance.current = null;
  };

  useEffect(() => () => {
    alive.current = false;
    stopAdvance();
  }, []);
  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }); }, []);
  useEffect(() => {
    indexRef.current = index;
    playableRef.current = playable;
  }, [index, playable]);
  useEffect(() => {
    if (current) onSegmentChange?.(current.id);
  }, [current, onSegmentChange]);
  useEffect(() => {
    if (!current?.audioUrl || !alive.current) return;
    clipFinished.current = false;
    playedThisClip.current = false;
    stopAdvance();
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
    if (!alive.current) return;
    if (status.playing) playedThisClip.current = true;
    const atEnd = status.didJustFinish || (status.isLoaded && status.duration > 0 && status.currentTime > 0 && status.currentTime >= status.duration - 0.2);
    const finished = playedThisClip.current && !status.playing && atEnd;
    if (!finished || clipFinished.current) return;
    clipFinished.current = true;
    const currentIndex = indexRef.current;
    const clips = playableRef.current;
    const plan = playbackPlan({
      autoplay: autoplay.current,
      index: currentIndex,
      count: clips.length,
      kind: clips[currentIndex]?.kind ?? "narration",
    });
    if (plan.action === "ignore") return;
    if (plan.action === "complete") {
      try { player.clearLockScreenControls(); } catch { /* player already stopped */ }
      onComplete();
      return;
    }
    const token = clips[currentIndex]?.audioUrl;
    stopAdvance();
    cancelAdvance.current = armAdvance(plan.delayMs, () => {
      cancelAdvance.current = null;
      if (!alive.current || !autoplay.current) return;
      if (playableRef.current[indexRef.current]?.audioUrl !== token) return;
      if (plan.action === "hold") return;
      setIndex((value) => value + 1);
    }, (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    });
  }, [current?.audioUrl, onComplete, player, status.currentTime, status.didJustFinish, status.duration, status.isLoaded, status.playing]);
  // Last effect on purpose: React cleans effects up in declaration order, so
  // status and segment listeners are removed before this schedules release.
  // The microtask skips release when the effect runs again immediately
  // (Fast Refresh or Strict Mode) and still stops playback on a real unmount.
  useEffect(() => {
    const currentGeneration = ++generation.current;
    return () => {
      queueMicrotask(() => {
        // Reading the ref here is intentional: it changes when the effect re-runs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (generation.current !== currentGeneration) return;
        stopOwnedPlayer(player);
      });
    };
  }, [player]);

  const changeSpeed = () => {
    const next = (speedIndex + 1) % speeds.length;
    setSpeedIndex(next);
    player.setPlaybackRate(speeds[next]!);
  };
  const pausePlayback = () => {
    autoplay.current = false;
    stopAdvance();
    player.pause();
  };
  const resumePlayback = () => {
    autoplay.current = true;
    const action = resumeAction({ clipFinished: clipFinished.current, index, count: playable.length });
    if (action === "play") {
      player.play();
      return;
    }
    if (action === "complete") {
      onComplete();
      return;
    }
    setIndex((value) => Math.min(playable.length - 1, value + 1));
  };
  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const transcript = current ? lessonDisplayText(current.text) : "";
  return (
    <View style={[styles.player, { backgroundColor: theme.navy }]}>
      <View style={styles.now}><Body style={styles.kicker}>NOW PLAYING · {index + 1}/{playable.length}</Body><Heading style={styles.title}>{current?.speaker === "teacher" ? "Resolingo teacher" : current?.speaker === "speakerA" ? "Speaker A" : "Speaker B"}</Heading><Body style={styles.transcript}>{transcript}</Body>{current?.translation ? <Body style={styles.translation}>{current.translation}</Body> : null}</View>
      <View style={[styles.track, { backgroundColor: "#314262" }]}><View style={[styles.fill, { backgroundColor: theme.coral, width: percentWidth(progress * 100) }]} /></View>
      <View style={styles.controls}>
        <Button label={`${speeds[speedIndex]}×`} variant="ghost" onPress={changeSpeed} />
        <Pressable accessibilityRole="button" accessibilityLabel="Back ten seconds" onPress={() => void player.seekTo(Math.max(0, status.currentTime - 10))} style={styles.circle}><Body style={styles.controlText}>−10</Body></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? "Pause" : "Play"} onPress={() => status.playing ? pausePlayback() : resumePlayback()} style={[styles.play, { backgroundColor: theme.coral }]}><Body style={styles.playText}>{status.playing ? "Ⅱ" : "▶"}</Body></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Forward ten seconds" onPress={() => void player.seekTo(Math.min(status.duration, status.currentTime + 10))} style={styles.circle}><Body style={styles.controlText}>+10</Body></Pressable>
        <Button label="Next" variant="ghost" disabled={index >= playable.length - 1} onPress={() => { stopAdvance(); autoplay.current = true; setIndex((value) => Math.min(playable.length - 1, value + 1)); }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  player: { borderRadius: 26, padding: 20, gap: 18 }, now: { minHeight: 190, gap: 9, justifyContent: "center" }, kicker: { color: "#9FB0CC", fontSize: 11, fontWeight: "800", letterSpacing: 1.3 }, title: { color: "#FFFFFF" }, transcript: { color: "#FFFFFF", fontSize: 21, lineHeight: 30 }, translation: { color: "#BAC7DD" }, track: { height: 6, borderRadius: 3, overflow: "hidden" }, fill: { height: 6, borderRadius: 3 }, controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, circle: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, play: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center" }, controlText: { color: "#FFFFFF", fontWeight: "700" }, playText: { color: "#08152F", fontSize: 20, fontWeight: "800" },
});
