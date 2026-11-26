import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { lessonDisplayText, speakerLabel, type Lesson, type LessonSegment } from "@resolingo/shared";
import { useSegments } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LessonArtwork } from "@/components/LessonArtwork";
import { LessonPlayer } from "@/components/LessonPlayer";
import { MicGlyph } from "@/components/MicGlyph";
import { PressableScale } from "@/components/PressableScale";
import { SkipIcon } from "@/components/SkipIcon";
import { Body, Title } from "@/components/Typography";
import { markLessonCompleted, resolveAudioUrls, subscribeLesson } from "@/services/lessons";
import { report, track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { lessonAccent } from "@/theme/colors";
import { useTheme, type Theme } from "@/theme/tokens";
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
  // Artwork is the default view. Lessons made before artwork existed open on the transcript.
  const [view, setView] = useState<"artwork" | "transcript">("artwork");
  const [presented, setPresented] = useState<"full" | "mini">(expanded ? "full" : "mini");
  const [interactive, setInteractive] = useState(expanded);
  const closed = Math.max(0, screenHeight - collapsedOffset - MINI_PLAYER_HEIGHT);
  const y = useSharedValue(expanded ? 0 : closed);
  const closedY = useSharedValue(closed);
  const dragStart = useSharedValue(closed);
  const floor = useSharedValue(expanded ? 300 : MINI_PLAYER_HEIGHT);
  useEffect(() => {
    const docked = y.value >= closedY.value - 1;
    closedY.value = closed;
    if (docked) y.value = closed;
  }, [closed, closedY, y]);
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
  const screenH = useSharedValue(screenHeight);
  useEffect(() => {
    dockGap.value = collapsedOffset;
    screenH.value = screenHeight;
  }, [collapsedOffset, dockGap, screenH, screenHeight]);
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
                <Pressable accessibilityRole="button" accessibilityLabel="Minimize player" onPress={() => glideTo(false)} hitSlop={8} style={[styles.roundButton, { backgroundColor: theme.surfaceMuted }]}>
                  <Chevron color={theme.text} />
                </Pressable>
                <View style={styles.eyebrowWrap}>
                  <View style={[styles.typeDot, { backgroundColor: lesson ? lessonAccent(theme, lesson.type) : theme.border }]} />
                  <Body muted numberOfLines={1} style={styles.eyebrow}>{lesson ? kindLabel[lesson.type] : "Lesson"}{lesson?.manifest?.totalDurationMs ? ` · ${Math.max(1, Math.round(lesson.manifest.totalDurationMs / 60_000))} min` : ""}</Body>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close player" onPress={close} hitSlop={8} style={[styles.roundButton, { backgroundColor: theme.surfaceMuted }]}>
                  <Body style={[styles.closeIcon, { color: theme.text }]}>✕</Body>
                </Pressable>
              </View>
              <Title style={styles.sheetTitle} numberOfLines={2}>{lesson?.title ?? "Opening lesson"}</Title>
              {resolved?.artworkUrl ? <ViewToggle view={view} onChange={setView} /> : null}
            </View>
          </GestureDetector>
          {resolved?.artworkUrl && view === "artwork"
            ? <ArtworkView lesson={resolved} activeSegmentId={activeSegmentId} onShowTranscript={() => setView("transcript")} />
            : resolved ? <Transcript lesson={resolved} activeSegmentId={activeSegmentId} onJump={(id) => setJumpTo({ id, token: Date.now() })} /> : null}
        </View>
        <View style={styles.dock}>
          <GestureDetector gesture={playerPan}>
            <View>
              {resolved ? (
                <LessonPlayer lesson={resolved} mode={presented} onOpen={() => glideTo(true)} onComplete={() => void complete()} onStart={started} onSegmentChange={setActiveSegmentId} jumpTo={jumpTo} allowAnswerChecks={segments[0] !== "say"} />
              ) : presented === "full" ? (
                <View pointerEvents="none" style={[styles.player, { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: Math.max(16, insets.bottom + 8) }]}>
                  <View style={styles.scrubber}><View style={[styles.track, { backgroundColor: theme.surfaceMuted }]} /></View>
                  <View style={styles.times}>
                    <Body muted style={styles.clock}>0:00</Body>
                    <Body muted style={[styles.clock, styles.clockEnd]}>0:00</Body>
                  </View>
                  <View style={styles.transport}>
                    <View style={[styles.speedChip, { backgroundColor: theme.surfaceMuted }]}><Body style={styles.speed}>1×</Body></View>
                    <View style={styles.skip}><SkipIcon direction="back" color={theme.text} /></View>
                    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading lesson audio" style={[styles.bigPlay, { backgroundColor: theme.primaryFill }]}>
                      <ActivityIndicator size="large" color={theme.onPrimary} />
                    </View>
                    <View style={styles.skip}><SkipIcon direction="forward" color={theme.text} /></View>
                    <View style={styles.speedChipSpacer} />
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

function Chevron({ color }: { color: string }) {
  return <View accessibilityElementsHidden style={[styles.chevron, { borderColor: color }]} />;
}

function ViewToggle({ view, onChange }: { view: "artwork" | "transcript"; onChange: (view: "artwork" | "transcript") => void }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.toggle, { backgroundColor: theme.surfaceMuted }]}>
      {(["artwork", "transcript"] as const).map((option) => {
        const selected = option === view;
        return (
          <PressableScale haptic="selection" scaleTo={0.96}
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={[styles.toggleOption, selected ? [styles.toggleSelected, { backgroundColor: theme.surface }] : null]}
          >
            <Body style={[styles.toggleLabel, { color: selected ? theme.text : theme.textMuted }]}>{option === "artwork" ? "Artwork" : "Transcript"}</Body>
          </PressableScale>
        );
      })}
    </View>
  );
}

function openArtworkSize(screenWidth: number, screenHeight: number, top: number, bottom: number): number {
  // Header, caption, and the player controls. Kept smaller than that gap so the
  // picture fits when the sheet is open, and fixed so iOS does not decode it
  // at the short size the sheet passes through while it opens.
  const available = screenHeight - (top + 200) - (bottom + 220) - 132;
  return Math.max(120, Math.floor(Math.min(screenWidth - 72, available)));
}

/** A small dot in each speaker's color, so a glance shows who is talking. */
function speakerColor(theme: Theme, speaker: LessonSegment["speaker"]): string {
  if (speaker === "speakerA") return theme.coral;
  if (speaker === "speakerB") return theme.amber;
  return theme.brand;
}

function ArtworkView({ lesson, activeSegmentId, onShowTranscript }: { lesson: Lesson; activeSegmentId: string | null; onShowTranscript: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [failed, setFailed] = useState(false);
  const active = lesson.segments.find((segment) => segment.id === activeSegmentId) ?? lesson.segments[0];
  const size = openArtworkSize(screenWidth, screenHeight, insets.top, insets.bottom);
  useEffect(() => {
    if (lesson.artworkUrl) void Image.prefetch(lesson.artworkUrl);
  }, [lesson.artworkUrl]);
  return (
    <View style={styles.artworkView}>
      <View style={[styles.artworkShadow, { borderRadius: 28 }]}>
        {failed || !lesson.artworkUrl
          ? <LessonArtwork lesson={lesson} size={size} radius={28} />
          : <Image accessibilityIgnoresInvertColors accessibilityLabel={`Artwork for ${lesson.title}`} resizeMode="cover" source={{ uri: lesson.artworkUrl }} onError={() => setFailed(true)} style={[styles.artwork, { width: size, height: size, backgroundColor: theme.surfaceMuted }]} />}
      </View>
      {active ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Show transcript" accessibilityHint="Opens the full transcript" onPress={onShowTranscript} style={styles.nowLine}>
          <View style={styles.speakerRow}>
            <View style={[styles.speakerDot, { backgroundColor: speakerColor(theme, active.speaker) }]} />
            <Body muted style={styles.speakerName}>{speakerLabel(active.speaker, lesson.speakerNames)}</Body>
          </View>
          <Body numberOfLines={3} style={[styles.nowLineText, styles.nowLineMain]}>{lessonDisplayText(active.text)}</Body>
          {active.translation ? <Body muted numberOfLines={2} style={[styles.nowLineText, styles.nowLineTranslation]}>{lessonDisplayText(active.translation)}</Body> : null}
        </Pressable>
      ) : null}
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
        {lesson.segments.map((segment, index) => {
          const highlighted = segment.id === activeSegmentId;
          const previous = lesson.segments[index - 1];
          const newSpeaker = !previous || previous.speaker !== segment.speaker;
          const inTarget = lesson.targetLanguage ? segment.language === lesson.targetLanguage : segment.speaker !== "teacher";
          const yourTurn = (segment.pauseAfterMs ?? 0) >= 3_000;
          const name = speakerLabel(segment.speaker, lesson.speakerNames);
          return (
            <Pressable
              key={segment.id}
              accessibilityRole="button"
              accessibilityLabel={`${name}: ${lessonDisplayText(segment.text)}`}
              accessibilityHint="Plays the lesson from this line"
              accessibilityState={{ selected: highlighted }}
              onPress={() => onJump(segment.id)}
              onLayout={(event) => { frames.current[segment.id] = { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height }; if (segment.id === activeSegmentId && following.current) revealActive(); else if (segment.id === activeSegmentId) syncJump(); }}
              style={({ pressed }) => [
                styles.line,
                newSpeaker && index > 0 ? styles.lineNewSpeaker : null,
                highlighted ? { backgroundColor: theme.primaryTint } : pressed ? { backgroundColor: theme.surfaceMuted } : null,
              ]}
            >
              <View style={[styles.lineAccent, { backgroundColor: highlighted ? theme.brand : "transparent" }]} />
              <View style={styles.lineBody}>
                {newSpeaker ? (
                  <View style={styles.speakerRow}>
                    <View style={[styles.speakerDot, { backgroundColor: speakerColor(theme, segment.speaker) }]} />
                    <Body muted style={styles.speakerName}>{name}</Body>
                  </View>
                ) : null}
                <Body style={[styles.lineText, inTarget ? styles.lineTarget : null, !highlighted && !inTarget ? { color: theme.textMuted } : null]}>{lessonDisplayText(segment.text)}</Body>
                {segment.transliteration ? <Body muted style={styles.lineTranslation}>{segment.transliteration}</Body> : null}
                {segment.translation ? <Body muted style={styles.lineTranslation}>{lessonDisplayText(segment.translation)}</Body> : null}
                {yourTurn ? (
                  <View style={[styles.turnChip, { backgroundColor: theme.surfaceMuted }]}>
                    <MicGlyph color={theme.textMuted} size={11} />
                    <Body muted style={styles.turnLabel}>Your turn to answer</Body>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {jumpDirection ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Jump to the line that is playing" onPress={scrollToActive} style={[styles.jump, { backgroundColor: theme.primaryFill }]}>
          <Body style={[styles.jumpLabel, { color: theme.onPrimary }]}>{jumpDirection === "up" ? "↑" : "↓"}  Now playing</Body>
        </Pressable>
      ) : null}
    </View>
  );
}

const kindLabel = { conversation: "Conversation", grammar: "Grammar", phrase: "Phrase" } as const;

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill },
  sheet: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
  story: { flex: 1, minHeight: 0, paddingHorizontal: 20 },
  sheetHeader: { gap: 6, paddingBottom: 4 },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginBottom: 4 },
  dock: { flexShrink: 0 },
  sheetBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  roundButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  chevron: { width: 10, height: 10, borderRightWidth: 2.5, borderBottomWidth: 2.5, transform: [{ rotate: "45deg" }], marginTop: -4 },
  closeIcon: { fontSize: 14, lineHeight: 18, fontWeight: "800" },
  eyebrowWrap: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  typeDot: { width: 8, height: 8, borderRadius: 4 },
  eyebrow: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  sheetTitle: { fontSize: 24, lineHeight: 30, textAlign: "center", marginTop: 4 },
  transcript: { flex: 1 },
  toggle: { flexDirection: "row", alignSelf: "center", width: "100%", maxWidth: 320, borderRadius: 999, padding: 3, marginTop: 6 },
  toggleOption: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 999 },
  toggleSelected: { shadowColor: "#08152F", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  toggleLabel: { fontSize: 14, lineHeight: 18, fontWeight: "700" },
  artworkView: { flex: 1, alignItems: "center", justifyContent: "center", gap: 20, paddingVertical: 12, minHeight: 0, overflow: "hidden" },
  artworkShadow: { shadowColor: "#08152F", shadowOpacity: 0.22, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  artwork: { borderRadius: 28 },
  nowLine: { alignSelf: "stretch", alignItems: "center", gap: 4, minHeight: 84, paddingHorizontal: 8 },
  nowLineText: { textAlign: "center" },
  nowLineMain: { fontSize: 19, lineHeight: 26, fontWeight: "700" },
  nowLineTranslation: { fontSize: 15, lineHeight: 21 },
  speakerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  speakerDot: { width: 7, height: 7, borderRadius: 4 },
  speakerName: { fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  transcriptContent: { paddingTop: 12, paddingBottom: 32 },
  line: { flexDirection: "row", borderRadius: 16, paddingVertical: 8, paddingRight: 12, marginHorizontal: -8 },
  lineNewSpeaker: { marginTop: 14 },
  lineAccent: { width: 4, borderRadius: 2, marginLeft: 8, marginRight: 10 },
  lineBody: { flex: 1, gap: 3 },
  lineText: { fontSize: 17, lineHeight: 25 },
  lineTarget: { fontWeight: "600" },
  lineTranslation: { fontSize: 14, lineHeight: 20 },
  turnChip: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginTop: 3 },
  turnLabel: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  player: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 24, paddingTop: 14, gap: 6 },
  scrubber: { height: 32, justifyContent: "center" },
  track: { height: 6, borderRadius: 3 },
  times: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: -4 },
  clock: { fontSize: 12, lineHeight: 16, fontWeight: "600", minWidth: 64 },
  clockEnd: { textAlign: "right" },
  speedChip: { width: 52, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  speedChipSpacer: { width: 52 },
  speed: { fontSize: 14, lineHeight: 18, fontWeight: "800" },
  transport: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 2, paddingBottom: 8 },
  skip: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  bigPlay: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  waiting: { minHeight: MINI_PLAYER_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 10, borderTopWidth: StyleSheet.hairlineWidth },
  waitingSpinner: { minWidth: 48, alignItems: "center" },
  waitingTitle: { flex: 1, fontWeight: "700" },
  jump: { position: "absolute", alignSelf: "center", bottom: 12, minHeight: 40, borderRadius: 20, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", shadowColor: "#08152F", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  jumpLabel: { fontSize: 14, lineHeight: 18, fontWeight: "700" },
});
