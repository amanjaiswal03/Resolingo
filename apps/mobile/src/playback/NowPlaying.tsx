import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { lessonDisplayText, speakerLabel, type Lesson } from "@resolingo/shared";
import { useSegments } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/Card";
import { LessonPlayer } from "@/components/LessonPlayer";
import { SkipIcon } from "@/components/SkipIcon";
import { Body, Heading, Title } from "@/components/Typography";
import { markLessonCompleted, resolveAudioUrls, subscribeLesson } from "@/services/lessons";
import { report, track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";
import { MINI_PLAYER_HEIGHT, TAB_BAR_HEIGHT, usePlayback } from "./PlaybackProvider";

export function NowPlaying() {
  const { lessonId } = usePlayback();
  if (!lessonId) return null;
  return <NowPlayingSession key={lessonId} lessonId={lessonId} />;
}

// Reanimated shared values are written in gesture worklets. The React compiler
// treats that write as a render mutation, so this player stays on the manual pattern.
/* eslint-disable react-hooks/immutability, react-hooks/preserve-manual-memoization, react-hooks/refs */
function NowPlayingSession({ lessonId }: { lessonId: string }) {
  const { user, profile } = useSession();
  const { expanded, expand, collapse, close } = usePlayback();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const { height: screenHeight } = useWindowDimensions();
  const collapsedOffset = segments[0] === "(tabs)" ? TAB_BAR_HEIGHT : insets.bottom;
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [resolved, setResolved] = useState<Lesson | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState<{ id: string; token: number } | null>(null);
  const [presented, setPresented] = useState<"full" | "mini">(expanded ? "full" : "mini");
  const [interactive, setInteractive] = useState(expanded);
  const closed = Math.max(0, screenHeight - collapsedOffset - MINI_PLAYER_HEIGHT);
  const y = useSharedValue(expanded ? 0 : closed);
  const closedY = useSharedValue(closed);
  const dragStart = useSharedValue(closed);
  const floor = useSharedValue(expanded ? 300 : MINI_PLAYER_HEIGHT);
  closedY.value = closed;
  const settle = useCallback((open: boolean) => {
    setPresented(open ? "full" : "mini");
    setInteractive(open);
    if (open) expand();
    else collapse();
  }, [collapse, expand]);
  const nudge = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);
  const settleRef = useRef(settle);
  const nudgeRef = useRef(nudge);
  settleRef.current = settle;
  nudgeRef.current = nudge;
  const settleFromUI = useCallback((open: boolean) => settleRef.current(open), []);
  const nudgeFromUI = useCallback(() => nudgeRef.current(), []);
  const showFull = useCallback(() => {
    floor.value = 300;
    setPresented("full");
    setInteractive(true);
  }, [floor]);
  const showMini = useCallback(() => {
    floor.value = MINI_PLAYER_HEIGHT;
    setPresented("mini");
  }, [floor]);
  const glideTo = useCallback((open: boolean, velocity = 0) => {
    if (open) {
      showFull();
      nudge();
    } else showMini();
    y.value = withSpring(open ? 0 : closedY.value, {
      velocity,
      damping: open ? 32 : 26,
      stiffness: open ? 140 : 190,
      mass: open ? 0.72 : 0.5,
      overshootClamping: true,
    }, (finished) => {
      if (finished) runOnJS(settleFromUI)(open);
    });
  }, [closedY, nudge, settleFromUI, showFull, showMini, y]);
  const buildPan = () => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onStart(() => {
      dragStart.value = y.value;
    })
    .onUpdate((event) => {
      const next = dragStart.value + event.translationY;
      y.value = Math.min(closedY.value, Math.max(0, next));
    })
    .onEnd((event) => {
      const projected = y.value + event.velocityY * 0.3;
      const open = projected < closedY.value * 0.42;
      if (open) {
        runOnJS(showFull)();
        runOnJS(nudgeFromUI)();
      } else runOnJS(showMini)();
      y.value = withSpring(open ? 0 : closedY.value, {
        velocity: event.velocityY,
        damping: open ? 32 : 26,
        stiffness: open ? 140 : 190,
        mass: open ? 0.72 : 0.5,
        overshootClamping: true,
      }, (finished) => {
        if (finished) runOnJS(settleFromUI)(open);
      });
    });
  const headerPan = useRef(buildPan()).current;
  const playerPan = useRef(buildPan()).current;
  const wasExpanded = useRef(expanded);
  useEffect(() => {
    if (expanded && !wasExpanded.current && y.value > 1) glideTo(true);
    wasExpanded.current = expanded;
  }, [expanded, glideTo, y]);
  const dockGap = useSharedValue(collapsedOffset);
  dockGap.value = collapsedOffset;
  const screenH = useSharedValue(screenHeight);
  screenH.value = screenHeight;
  const sheetStyle = useAnimatedStyle(() => {
    const span = Math.max(closedY.value, 1);
    const bottom = interpolate(y.value, [0, span], [0, dockGap.value]);
    return { bottom, height: Math.max(floor.value, screenH.value - bottom - y.value) };
  });
  useEffect(() => {
    if (!user) close();
  }, [close, user]);
  useEffect(() => {
    if (!user) return;
    return subscribeLesson(user.uid, lessonId, (next) => {
      if (!next) {
        close();
        return;
      }
      setLesson(next);
    }, (error) => report(error));
  }, [close, lessonId, user]);
  useEffect(() => {
    if (lesson?.status !== "ready") return;
    let cancelled = false;
    void resolveAudioUrls(lesson).then((next) => {
      if (!cancelled) setResolved(next);
    }).catch((error: unknown) => {
      if (cancelled) return;
      report(error);
      Alert.alert("Audio unavailable", "Please check your connection and try again.");
      close();
    });
    return () => { cancelled = true; };
  }, [close, lesson]);
  const complete = useCallback(async () => {
    if (!user || !lesson) return;
    await markLessonCompleted(user.uid, lessonId);
    if (profile?.telemetryConsent) await track("lesson_completed", { type: lesson.type });
  }, [lesson, lessonId, profile?.telemetryConsent, user]);
  const started = useCallback(() => {
    if (profile?.telemetryConsent && lesson) void track("playback_started", { type: lesson.type });
  }, [lesson, profile?.telemetryConsent]);
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Animated.View style={[styles.sheet, { backgroundColor: theme.background }, sheetStyle]}>
        <View pointerEvents={interactive ? "auto" : "none"} style={styles.story}>
          <GestureDetector gesture={headerPan}>
            <View style={[styles.sheetHeader, { paddingTop: insets.top + 6 }]}>
              <View style={[styles.grabber, { backgroundColor: theme.border }]} />
              <View style={styles.sheetBar}>
                <Pressable accessibilityRole="button" accessibilityLabel="Hide transcript" onPress={() => glideTo(false)} hitSlop={8}><Body style={styles.chevron}>⌄</Body></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Close player" onPress={close} hitSlop={8}><Body muted>Close</Body></Pressable>
              </View>
              <Body muted style={styles.eyebrow}>{lesson?.type.toUpperCase()}{lesson?.manifest?.totalDurationMs ? ` · ${Math.max(1, Math.round(lesson.manifest.totalDurationMs / 60_000))} MIN` : ""}</Body>
              <Title style={styles.sheetTitle} numberOfLines={2}>{lesson?.title ?? "Opening lesson"}</Title>
            </View>
          </GestureDetector>
          {resolved ? <Transcript lesson={resolved} activeSegmentId={activeSegmentId} onJump={(id) => setJumpTo({ id, token: Date.now() })} /> : null}
        </View>
        <View style={styles.dock}>
          <GestureDetector gesture={playerPan}>
            <View>
              {resolved ? (
                <LessonPlayer lesson={resolved} mode={presented} onOpen={() => glideTo(true)} onComplete={() => void complete()} onStart={started} onSegmentChange={setActiveSegmentId} jumpTo={jumpTo} allowAnswerChecks={segments[0] !== "say"} />
              ) : presented === "full" ? (
                <View pointerEvents="none" style={[styles.player, { backgroundColor: theme.surface, paddingBottom: Math.max(16, insets.bottom + 8) }]}>
                  <View style={styles.scrubber}><View style={[styles.track, { backgroundColor: theme.border }]} /></View>
                  <View style={styles.times}>
                    <Body muted style={styles.clock}>0:00</Body>
                    <Body style={styles.speed}>1×</Body>
                    <Body muted style={[styles.clock, styles.clockEnd]}>0:00</Body>
                  </View>
                  <View style={styles.transport}>
                    <View style={styles.skip}><SkipIcon direction="back" color={theme.text} /></View>
                    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading lesson audio" style={[styles.bigPlay, { backgroundColor: theme.primary }]}>
                      <ActivityIndicator size="large" color={theme.onPrimary} />
                    </View>
                    <View style={styles.skip}><SkipIcon direction="forward" color={theme.text} /></View>
                  </View>
                </View>
              ) : (
                <View pointerEvents="none" style={[styles.waiting, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
                  <Body style={styles.waitingTitle} numberOfLines={1}>{lesson?.title ?? "Opening lesson"}</Body>
                  <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading lesson audio" style={styles.waitingSpinner}>
                    <ActivityIndicator color={theme.primary} />
                  </View>
                </View>
              )}
            </View>
          </GestureDetector>
        </View>
      </Animated.View>
    </View>
  );
}

function Transcript({ lesson, activeSegmentId, onJump }: { lesson: Lesson; activeSegmentId: string | null; onJump: (id: string) => void }) {
  const theme = useTheme();
  const transcriptRef = useRef<ScrollView>(null);
  const frames = useRef<Record<string, { y: number; height: number }>>({});
  const scrollY = useRef(0);
  const viewportHeight = useRef(0);
  const scrollFrame = useRef<number | null>(null);
  const programmatic = useRef(false);
  const following = useRef(true);
  const [jumpDirection, setJumpDirection] = useState<"up" | "down" | null>(null);
  const frameOf = useCallback((id: string | null) => id ? frames.current[id] : undefined, []);
  const visible = useCallback((frame: { y: number; height: number } | undefined) => {
    const viewHeight = viewportHeight.current;
    if (!frame || viewHeight <= 0) return false;
    const top = scrollY.current;
    return frame.y + frame.height > top + 12 && frame.y < top + viewHeight - 12;
  }, []);
  const syncJump = useCallback(() => {
    const frame = frameOf(activeSegmentId);
    const viewHeight = viewportHeight.current;
    if (!frame || viewHeight <= 0) {
      setJumpDirection((current) => current === null ? current : null);
      return;
    }
    const next = visible(frame) ? null : frame.y < scrollY.current ? "up" : "down";
    setJumpDirection((current) => current === next ? current : next);
  }, [activeSegmentId, frameOf, visible]);
  const glideTo = useCallback((target: number) => {
    const start = scrollY.current;
    const change = Math.max(0, target) - start;
    if (Math.abs(change) < 2) return;
    if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
    programmatic.current = true;
    const duration = Math.min(560, Math.max(260, Math.abs(change) * 0.38));
    const startedAt = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = 1 - (1 - t) ** 3;
      scrollY.current = start + change * eased;
      transcriptRef.current?.scrollTo({ y: scrollY.current, animated: false });
      if (t < 1) scrollFrame.current = requestAnimationFrame(tick);
      else {
        scrollFrame.current = null;
        programmatic.current = false;
        syncJump();
      }
    };
    scrollFrame.current = requestAnimationFrame(tick);
  }, [syncJump]);
  const revealActive = useCallback(() => {
    const frame = frameOf(activeSegmentId);
    const viewHeight = viewportHeight.current;
    if (!frame || viewHeight <= 0 || visible(frame)) return;
    const padding = 24;
    const top = scrollY.current;
    const bottom = top + viewHeight;
    const target = frame.y < top + padding
      ? frame.y - padding
      : frame.y + frame.height - viewHeight + padding;
    glideTo(Math.min(target, Math.max(0, frame.y - padding)));
  }, [activeSegmentId, frameOf, glideTo, visible]);
  const scrollToActive = () => {
    const frame = frameOf(activeSegmentId);
    if (!frame) return;
    following.current = true;
    glideTo(frame.y - 24);
  };
  useEffect(() => {
    if (!following.current) {
      syncJump();
      return;
    }
    revealActive();
  }, [activeSegmentId, revealActive, syncJump]);
  return (
    <View style={styles.transcript}>
      <ScrollView
        ref={transcriptRef}
        contentContainerStyle={styles.transcriptContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScrollBeginDrag={() => {
          if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
          scrollFrame.current = null;
          programmatic.current = false;
        }}
        onLayout={(event) => { viewportHeight.current = event.nativeEvent.layout.height; if (following.current) revealActive(); else syncJump(); }}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
          viewportHeight.current = event.nativeEvent.layoutMeasurement.height;
          if (programmatic.current) return;
          following.current = visible(frameOf(activeSegmentId));
          syncJump();
        }}
      >
        <Heading>Transcript</Heading>
        {lesson.segments.map((segment) => {
          const highlighted = segment.id === activeSegmentId;
          return (
            <Pressable key={segment.id} accessibilityRole="button" accessibilityLabel="Play this part" onPress={() => onJump(segment.id)} onLayout={(event) => { frames.current[segment.id] = { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height }; if (segment.id === activeSegmentId && following.current) revealActive(); else if (segment.id === activeSegmentId) syncJump(); }}>
              <Card style={highlighted ? { backgroundColor: theme.surfaceMuted, borderColor: theme.primary, borderWidth: 2 } : undefined}>
                <Body muted>{speakerLabel(segment.speaker, lesson.speakerNames)}</Body>
                <Body>{lessonDisplayText(segment.text)}</Body>
                {segment.translation ? <Body muted>{lessonDisplayText(segment.translation)}</Body> : null}
                {segment.transliteration ? <Body muted>{segment.transliteration}</Body> : null}
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
      {jumpDirection ? <Pressable accessibilityRole="button" accessibilityLabel="Jump to the line that is playing" onPress={scrollToActive} style={[styles.jump, { backgroundColor: theme.surface, borderColor: theme.border }]}><Body style={styles.jumpIcon}>{jumpDirection === "up" ? "↑" : "↓"}</Body></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill },
  sheet: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
  story: { flex: 1, minHeight: 0, paddingHorizontal: 20 },
  sheetHeader: { gap: 4 },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginBottom: 6 },
  dock: { flexShrink: 0 },
  sheetBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chevron: { fontSize: 28, lineHeight: 30, fontWeight: "700" },
  eyebrow: { fontSize: 12, lineHeight: 16 },
  sheetTitle: { fontSize: 26, lineHeight: 31 },
  transcript: { flex: 1 },
  transcriptContent: { gap: 16, paddingTop: 12, paddingBottom: 24 },
  player: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 22, paddingTop: 18, gap: 10 },
  scrubber: { height: 28, justifyContent: "center" },
  track: { height: 5, borderRadius: 3 },
  times: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clock: { fontSize: 13, lineHeight: 18, minWidth: 64 },
  clockEnd: { textAlign: "right" },
  speed: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  transport: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 28, paddingTop: 6 },
  skip: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  bigPlay: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  waiting: { minHeight: MINI_PLAYER_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 10, borderTopWidth: StyleSheet.hairlineWidth },
  waitingSpinner: { minWidth: 48, alignItems: "center" },
  waitingTitle: { flex: 1, fontWeight: "700" },
  jump: { position: "absolute", right: 8, bottom: 12, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, shadowColor: "#08152F", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  jumpIcon: { fontSize: 20, lineHeight: 24, fontWeight: "700" },
});
