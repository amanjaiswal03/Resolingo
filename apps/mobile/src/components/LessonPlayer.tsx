import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { createAudioPlaylist, setAudioModeAsync, useAudioPlaylistStatus } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Lesson } from "@resolingo/shared";
import { percentWidth } from "@/lesson/navigation";
import { stopOwnedPlaylist } from "@/lesson/player-lifecycle";
import { elapsedMs, formatClock, lessonTimeline, playbackClips, seekInTimeline, segmentAtClipTime } from "@/lesson/timeline";
import { Button } from "./Button";
import { Body } from "./Typography";
import { useTheme } from "@/theme/tokens";

const speeds = [0.8, 1, 1.2] as const;

export function LessonPlayer({ lesson, onComplete, onStart, onSegmentChange, jumpTo }: {
  lesson: Lesson;
  onComplete: () => void;
  onStart?: () => void;
  onSegmentChange?: (segmentId: string) => void;
  jumpTo?: { id: string; token: number } | null;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const playable = useMemo(() => playbackClips(lesson.segments), [lesson.segments]);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [measuredMs, setMeasuredMs] = useState<Record<number, number>>({});
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
  const started = useRef(false);
  const completed = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const onStartRef = useRef(onStart);
  const trackWidth = useRef(0);
  const jumpToken = useRef<number | null>(null);
  const indexRef = useRef(0);
  // Read by the playback effects below. Assigned during render so a jump in the same commit sees the latest callback.
  // eslint-disable-next-line react-hooks/refs -- playback callback mirror
  onStartRef.current = onStart;
  // Owned outside useAudioPlaylist so we can pause before destroy(). That hook
  // releases in its own effect, which runs before later cleanups and crashes
  // iOS on the way back to home.
  const [playlist] = useState(() => createAudioPlaylist({
    sources: playable.map((clip) => ({ uri: clip.audioUrl, name: lesson.title })),
    updateInterval: 250,
    loop: "none",
  }));
  const status = useAudioPlaylistStatus(playlist);
  const timeline = useMemo(() => lessonTimeline(playable.map((clip, index) => {
    const durationMs = measuredMs[index] ?? clip.durationMs;
    return durationMs ? { durationMs } : {};
  })), [measuredMs, playable]);
  // eslint-disable-next-line react-hooks/refs -- compared inside the jump effect in this commit
  indexRef.current = status.currentIndex;
  const playedElapsed = elapsedMs(timeline, status.currentIndex, status.currentTime);
  const shownElapsed = scrubRatio == null ? playedElapsed : scrubRatio * timeline.totalMs;
  const position = seekInTimeline(timeline, shownElapsed);
  const shown = playable[position.index] ?? playable[0];
  const activeSegmentId = shown ? segmentAtClipTime(shown, position.offsetSec * 1_000, timeline.durationsMs[position.index]) : undefined;
  const progress = timeline.totalMs > 0 ? Math.min(1, shownElapsed / timeline.totalMs) : 0;

  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }); }, []);
  /* eslint-disable react-hooks/immutability -- playbackRate is a property of the expo-audio playlist */
  useEffect(() => {
    if (!alive.current || playable.length === 0) return;
    playlist.playbackRate = 1;
    playlist.play();
    if (!started.current) {
      started.current = true;
      onStartRef.current?.();
    }
  }, [playlist, playable.length]);
  /* eslint-enable react-hooks/immutability */
  useEffect(() => {
    if (activeSegmentId) onSegmentChange?.(activeSegmentId);
  }, [activeSegmentId, onSegmentChange]);
  useEffect(() => {
    if (!jumpTo || jumpTo.token === jumpToken.current) return;
    jumpToken.current = jumpTo.token;
    const index = playable.findIndex((clip) => clip.segmentIds.includes(jumpTo.id));
    const start = timeline.startsMs[index];
    if (index < 0 || start == null) return;
    completed.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drop the scrub preview when an external jump is applied
    setScrubRatio(null);
    if (index !== indexRef.current) playlist.skipTo(index);
    void playlist.seekTo(0);
    playlist.play();
  }, [jumpTo, playable, playlist, timeline.startsMs]);
  useEffect(() => {
    if (!status.isLoaded || status.duration <= 0) return;
    const durationMs = Math.round(status.duration * 1_000);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- record the loaded clip length for the timeline
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
    // eslint-disable-next-line react-hooks/immutability -- playbackRate is a property of the expo-audio playlist
    playlist.playbackRate = speeds[next]!;
  };
  const seekToLessonMs = (targetMs: number) => {
    if (timeline.totalMs <= 0) return;
    completed.current = false;
    const index = status.currentIndex;
    const target = seekInTimeline(timeline, targetMs);
    if (target.index !== index) playlist.skipTo(target.index);
    void playlist.seekTo(target.offsetSec);
  };
  const seekBy = (deltaSec: number) => seekToLessonMs(playedElapsed + deltaSec * 1_000);
  const ratioFromX = (x: number) => trackWidth.current <= 0 ? 0 : Math.min(1, Math.max(0, x / trackWidth.current));
  const yourTurn = shown?.segments.some((segment) => (segment.pauseAfterMs ?? 0) > 0) ?? false;
  return (
    <View style={[styles.player, { backgroundColor: theme.navy, paddingBottom: Math.max(8, insets.bottom) }]}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Lesson position"
        accessibilityValue={{ text: `${formatClock(shownElapsed)} of ${formatClock(timeline.totalMs)}` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => seekBy(event.nativeEvent.actionName === "increment" ? 10 : -10)}
        onLayout={(event) => { trackWidth.current = event.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => timeline.totalMs > 0}
        onMoveShouldSetResponder={() => timeline.totalMs > 0}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => setScrubRatio(ratioFromX(event.nativeEvent.locationX))}
        onResponderMove={(event) => setScrubRatio(ratioFromX(event.nativeEvent.locationX))}
        onResponderRelease={(event) => {
          const ratio = ratioFromX(event.nativeEvent.locationX);
          setScrubRatio(null);
          seekToLessonMs(ratio * timeline.totalMs);
        }}
        onResponderTerminate={() => setScrubRatio(null)}
        style={styles.scrubber}
      >
        <View style={[styles.track, { backgroundColor: "#314262" }]}><View style={[styles.fill, { backgroundColor: theme.coral, width: percentWidth(progress * 100) }]} /></View>
        <View style={[styles.thumb, { backgroundColor: theme.coral, left: percentWidth(progress * 100) }]} />
      </View>
      <View style={styles.times}><Body style={styles.time}>{formatClock(shownElapsed)}</Body>{yourTurn ? <Body style={styles.time}>Say it aloud</Body> : null}<Body style={styles.time}>{formatClock(timeline.totalMs)}</Body></View>
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
  player: { borderRadius: 22, paddingHorizontal: 16, paddingTop: 8, gap: 2 }, scrubber: { height: 28, justifyContent: "center" }, track: { height: 5, borderRadius: 3, overflow: "hidden" }, fill: { height: 5, borderRadius: 3 }, thumb: { position: "absolute", top: 6, width: 16, height: 16, borderRadius: 8, marginLeft: -8, borderWidth: 2, borderColor: "#FFFFFF" }, times: { flexDirection: "row", justifyContent: "space-between" }, time: { color: "#9FB0CC", fontSize: 12, fontVariant: ["tabular-nums"] }, controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, circle: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, play: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" }, controlText: { color: "#FFFFFF", fontWeight: "700" }, playText: { color: "#08152F", fontSize: 18, fontWeight: "800" },
});
