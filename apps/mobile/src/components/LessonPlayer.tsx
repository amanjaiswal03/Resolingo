import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
	createAudioPlaylist,
	setAudioModeAsync,
	useAudioPlaylistStatus,
} from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { lessonDisplayText, type Lesson } from "@resolingo/shared";
import { percentWidth } from "@/lesson/navigation";
import { stopOwnedPlaylist } from "@/lesson/player-lifecycle";
import {
	elapsedMs,
	formatClock,
	lessonTimeline,
	playbackClips,
	seekInTimeline,
	segmentAtClipTime,
	segmentStartInClip,
} from "@/lesson/timeline";
import { Body } from "./Typography";
import { useTheme } from "@/theme/tokens";

const speeds = [0.8, 1, 1.2] as const;

const kindLabel = { conversation: "Conversation", grammar: "Grammar", phrase: "Phrase" } as const;

export function LessonPlayer({
	lesson,
	onComplete,
	onStart,
	onSegmentChange,
	jumpTo,
	mode = "full",
	onOpen,
	placement = "bottom",
}: {
	lesson: Lesson;
	onComplete: () => void;
	onStart?: () => void;
	onSegmentChange?: (segmentId: string) => void;
	jumpTo?: { id: string; token: number } | null;
	mode?: "full" | "mini";
	onOpen?: () => void;
	placement?: "top" | "bottom";
}) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const playable = useMemo(
		() => playbackClips(lesson.segments),
		[lesson.segments],
	);
	const [speedIndex, setSpeedIndex] = useState(1);
	const [measuredMs, setMeasuredMs] = useState<Record<number, number>>({});
	const [scrubLock, setScrubLock] = useState(0);
	const scrubRatioRef = useRef<number | null>(null);
	const scrubbingRef = useRef(false);
	const fillRef = useRef<View>(null);
	const thumbRef = useRef<View>(null);
	const elapsedRef = useRef<Text>(null);
	const paintFrame = useRef<number | null>(null);
	const pendingRatio = useRef<number | null>(null);
	const started = useRef(false);
	const completed = useRef(false);
	const alive = useRef(true);
	const generation = useRef(0);
	const onStartRef = useRef(onStart);
	const trackWidth = useRef(0);
	const trackPageX = useRef(0);
	const scrubberRef = useRef<View>(null);
	const seekGeneration = useRef(0);
	const jumpToken = useRef<number | null>(null);
	const indexRef = useRef(0);
	// Read by the playback effects below. Assigned during render so a jump in the same commit sees the latest callback.
	// eslint-disable-next-line react-hooks/refs -- playback callback mirror
	onStartRef.current = onStart;
	// Owned outside useAudioPlaylist so we can pause before destroy(). That hook
	// releases in its own effect, which runs before later cleanups and crashes
	// iOS on the way back to home.
	const [playlist] = useState(() =>
		createAudioPlaylist({
			sources: playable.map((clip) => ({
				uri: clip.audioUrl,
				name: lesson.title,
			})),
			updateInterval: 250,
			loop: "none",
		}),
	);
	const status = useAudioPlaylistStatus(playlist);
	const timeline = useMemo(
		() =>
			lessonTimeline(
				playable.map((clip, index) => {
					const durationMs = measuredMs[index] ?? clip.durationMs;
					return durationMs ? { durationMs } : {};
				}),
			),
		[measuredMs, playable],
	);
	// eslint-disable-next-line react-hooks/refs -- compared inside the jump effect in this commit
	indexRef.current = status.currentIndex;
	const playedElapsed = elapsedMs(
		timeline,
		status.currentIndex,
		status.currentTime,
	);
	// The finger position lives outside React so playback ticks do not pull the thumb backward.
	// eslint-disable-next-line react-hooks/refs -- latest scrub position, written by the drag responder
	const shownElapsed = scrubRatioRef.current == null ? playedElapsed : scrubRatioRef.current * timeline.totalMs;
	const position = seekInTimeline(timeline, shownElapsed);
	const shown = playable[position.index] ?? playable[0];
	const activeSegmentId = shown
		? segmentAtClipTime(
				shown,
				position.offsetSec * 1_000,
				timeline.durationsMs[position.index],
			)
		: undefined;
	const progress =
		timeline.totalMs > 0 ? Math.min(1, shownElapsed / timeline.totalMs) : 0;

	useEffect(
		() => () => {
			alive.current = false;
		},
		[],
	);
	useEffect(() => {
		void setAudioModeAsync({
			playsInSilentMode: true,
			shouldPlayInBackground: true,
			interruptionMode: "doNotMix",
		});
	}, []);
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
		if (scrubbingRef.current || scrubRatioRef.current != null) return;
		if (activeSegmentId) onSegmentChange?.(activeSegmentId);
	}, [activeSegmentId, onSegmentChange, scrubLock]);
	useEffect(() => {
		if (scrubbingRef.current || scrubRatioRef.current == null || timeline.totalMs <= 0) return;
		const target = scrubRatioRef.current * timeline.totalMs;
		if (Math.abs(playedElapsed - target) > 700) return;
		scrubRatioRef.current = null;
		setScrubLock((lock) => lock + 1);
	}, [playedElapsed, timeline.totalMs]);
	useEffect(() => {
		if (!jumpTo || jumpTo.token === jumpToken.current) return;
		jumpToken.current = jumpTo.token;
		const index = playable.findIndex((clip) =>
			clip.segmentIds.includes(jumpTo.id),
		);
		const clip = playable[index];
		const start = timeline.startsMs[index];
		if (!clip || index < 0 || start == null) return;
		completed.current = false;
		scrubbingRef.current = false;
		scrubRatioRef.current = null;
		// eslint-disable-next-line react-hooks/set-state-in-effect -- drop the scrub preview when an external jump is applied
		setScrubLock((lock) => lock + 1);
		if (index !== indexRef.current) playlist.skipTo(index);
		void playlist.seekTo(
			segmentStartInClip(clip, jumpTo.id, timeline.durationsMs[index]) / 1_000,
		);
		playlist.play();
	}, [jumpTo, playable, playlist, timeline.durationsMs, timeline.startsMs]);
	useEffect(() => {
		if (!status.isLoaded || status.duration <= 0) return;
		const durationMs = Math.round(status.duration * 1_000);
		// eslint-disable-next-line react-hooks/set-state-in-effect -- record the loaded clip length for the timeline
		setMeasuredMs((currentMs) =>
			currentMs[status.currentIndex] === durationMs
				? currentMs
				: { ...currentMs, [status.currentIndex]: durationMs },
		);
	}, [status.currentIndex, status.duration, status.isLoaded]);
	useEffect(() => {
		if (
			!alive.current ||
			!status.didJustFinish ||
			status.currentIndex < playable.length - 1 ||
			completed.current
		)
			return;
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
		const target = seekInTimeline(timeline, targetMs);
		const generation = ++seekGeneration.current;
		void (async () => {
			// Changing clips rebuilds the queue at time zero, and a seek issued in that
			// same moment is dropped. Retry until the new clip accepts the position.
			if (target.index !== playlist.currentIndex) playlist.skipTo(target.index);
			for (let attempt = 0; attempt < 6; attempt += 1) {
				if (seekGeneration.current !== generation) return;
				await playlist.seekTo(target.offsetSec);
				if (seekGeneration.current !== generation) return;
				const landed = playlist.currentIndex === target.index && Math.abs(playlist.currentTime - target.offsetSec) < 0.35;
				if (landed || target.offsetSec < 0.05) return;
				await new Promise((resolve) => setTimeout(resolve, 60));
			}
		})();
	};
	const seekBy = (deltaSec: number) =>
		seekToLessonMs(playedElapsed + deltaSec * 1_000);
	const ratioFromX = (x: number) =>
		trackWidth.current <= 0
			? 0
			: Math.min(1, Math.max(0, x / trackWidth.current));
	const paintScrub = (ratio: number) => {
		const x = ratio * trackWidth.current;
		fillRef.current?.setNativeProps({ style: { width: x } });
		thumbRef.current?.setNativeProps({ style: { left: x } });
		elapsedRef.current?.setNativeProps({ text: formatClock(ratio * timeline.totalMs) });
	};
	const queueScrub = (ratio: number) => {
		scrubRatioRef.current = ratio;
		pendingRatio.current = ratio;
		if (paintFrame.current != null) return;
		paintFrame.current = requestAnimationFrame(() => {
			paintFrame.current = null;
			const next = pendingRatio.current;
			if (next == null) return;
			scrubRatioRef.current = next;
			paintScrub(next);
		});
	};
	const yourTurn =
		shown?.segments.some((segment) => (segment.pauseAfterMs ?? 0) > 0) ?? false;
	const activeLine = shown?.segments.find((segment) => segment.id === activeSegmentId);
	const lineText = activeLine ? lessonDisplayText(activeLine.text) : "";
	const toggle = () => (status.playing ? playlist.pause() : playlist.play());
	if (mode === "mini") {
		return (
			<View style={[styles.mini, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
				<View style={[styles.miniTrack, { backgroundColor: theme.border }]}>
					<View style={[styles.miniFill, { backgroundColor: theme.primary, width: percentWidth(progress * 100) }]} />
				</View>
				<View style={styles.miniRow}>
					<Pressable accessibilityRole="button" accessibilityLabel={`Open ${lesson.title}`} onPress={onOpen} style={styles.miniOpen}>
						<Text style={[styles.miniChevron, { color: theme.text }]}>⌃</Text>
						<View style={[styles.miniBadge, { backgroundColor: lesson.type === "grammar" ? theme.mint : lesson.type === "phrase" ? theme.coral : theme.amber }]}>
							<Body style={styles.miniBadgeText}>{lesson.type.slice(0, 1).toUpperCase()}</Body>
						</View>
						<View style={styles.miniCopy}>
							<Text numberOfLines={1} style={[styles.miniTitle, { color: theme.text }]}>{lineText || lesson.title}</Text>
							<Text numberOfLines={1} style={[styles.miniSubtitle, { color: theme.textMuted }]}>{lineText ? lesson.title : kindLabel[lesson.type]}</Text>
						</View>
					</Pressable>
					<Pressable accessibilityRole="button" accessibilityLabel={status.playing ? "Pause" : "Play"} onPress={toggle} style={styles.play}>
						<Text style={[styles.playIcon, { color: theme.primary }]}>{status.playing ? "Ⅱ" : "▶"}</Text>
					</Pressable>
				</View>
			</View>
		);
	}
	return (
		<View
			style={[
				styles.player,
				{
					backgroundColor: theme.surface,
					paddingBottom: placement === "top" ? 14 : Math.max(16, insets.bottom + 8),
				},
			]}
		>
			<View
				ref={scrubberRef}
				accessibilityRole="adjustable"
				accessibilityLabel="Lesson position"
				accessibilityValue={{
					text: `${formatClock(shownElapsed)} of ${formatClock(timeline.totalMs)}`,
				}}
				accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
				onAccessibilityAction={(event) =>
					seekBy(event.nativeEvent.actionName === "increment" ? 10 : -10)
				}
				onLayout={(event) => {
					trackWidth.current = event.nativeEvent.layout.width;
					scrubberRef.current?.measureInWindow((x, _y, width) => {
						trackPageX.current = x;
						if (width > 0) trackWidth.current = width;
					});
				}}
				onStartShouldSetResponder={() => timeline.totalMs > 0}
				onMoveShouldSetResponder={() => false}
				onResponderTerminationRequest={() => false}
				onResponderGrant={(event) => {
					scrubbingRef.current = true;
					queueScrub(ratioFromX(event.nativeEvent.pageX - trackPageX.current));
				}}
				onResponderMove={(event) => queueScrub(ratioFromX(event.nativeEvent.pageX - trackPageX.current))}
				onResponderRelease={(event) => {
					if (paintFrame.current != null) cancelAnimationFrame(paintFrame.current);
					paintFrame.current = null;
					const ratio = ratioFromX(event.nativeEvent.pageX - trackPageX.current);
					scrubbingRef.current = false;
					scrubRatioRef.current = ratio;
					paintScrub(ratio);
					seekToLessonMs(ratio * timeline.totalMs);
					setScrubLock((lock) => lock + 1);
				}}
				onResponderTerminate={() => {
					if (paintFrame.current != null) cancelAnimationFrame(paintFrame.current);
					paintFrame.current = null;
					scrubbingRef.current = false;
					scrubRatioRef.current = null;
					setScrubLock((lock) => lock + 1);
				}}
				style={styles.scrubber}
			>
				<View style={[styles.track, { backgroundColor: theme.border }]}>
					<View
						ref={fillRef}
						collapsable={false}
						style={[
							styles.fill,
							{
								backgroundColor: theme.primary,
								width: percentWidth(progress * 100),
							},
						]}
					/>
				</View>
				<View
					ref={thumbRef}
					collapsable={false}
					style={[
						styles.thumb,
						{
							backgroundColor: theme.primary,
							borderColor: theme.surface,
							left: percentWidth(progress * 100),
						},
					]}
				/>
			</View>
			{yourTurn ? <Text style={[styles.time, styles.turn, { color: theme.textMuted }]}>Say it aloud</Text> : null}
			<View style={styles.times}>
				<Text ref={elapsedRef} style={[styles.time, { color: theme.textMuted }]}>{formatClock(shownElapsed)}</Text>
				<Pressable accessibilityRole="button" accessibilityLabel="Playback speed" onPress={changeSpeed} hitSlop={8}>
					<Text style={[styles.speed, { color: theme.text }]}>{speeds[speedIndex]}×</Text>
				</Pressable>
				<Text style={[styles.time, styles.timeEnd, { color: theme.textMuted }]}>{formatClock(timeline.totalMs)}</Text>
			</View>
			<View style={styles.transport}>
				<Pressable accessibilityRole="button" accessibilityLabel="Back ten seconds" onPress={() => seekBy(-10)} style={styles.skip}>
					<Text style={[styles.controlText, { color: theme.text }]}>−10</Text>
				</Pressable>
				<Pressable accessibilityRole="button" accessibilityLabel={status.playing ? "Pause" : "Play"} onPress={toggle} style={[styles.bigPlay, { backgroundColor: theme.primary }]}>
					<Text style={[styles.bigPlayIcon, { color: theme.onPrimary }, !status.playing && styles.playNudge]}>{status.playing ? "Ⅱ" : "▶"}</Text>
				</Pressable>
				<Pressable accessibilityRole="button" accessibilityLabel="Forward ten seconds" onPress={() => seekBy(10)} style={styles.skip}>
					<Text style={[styles.controlText, { color: theme.text }]}>+10</Text>
				</Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	player: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 22, paddingTop: 18, gap: 10 },
	mini: { minHeight: 76, borderTopWidth: StyleSheet.hairlineWidth },
	miniTrack: { height: 2 },
	miniFill: { height: 2 },
	miniRow: { flex: 1, flexDirection: "row", alignItems: "center", paddingRight: 10 },
	miniOpen: { flex: 1, flexDirection: "row", alignItems: "center", gap: 14, paddingLeft: 16, paddingVertical: 12 },
	miniBadge: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
	miniBadgeText: { color: "#08152F", fontWeight: "800", fontSize: 14, lineHeight: 18 },
	miniCopy: { flex: 1, gap: 1 },
	miniTitle: { fontSize: 15, lineHeight: 18, fontWeight: "700" },
	miniSubtitle: { fontSize: 12, lineHeight: 15 },
	miniChevron: { fontSize: 20, lineHeight: 22, fontWeight: "700", width: 22 },
	scrubber: { height: 28, justifyContent: "center" },
	track: { height: 5, borderRadius: 3, overflow: "hidden" },
	fill: { height: 5, borderRadius: 3 },
	thumb: {
		position: "absolute",
		top: 6,
		width: 16,
		height: 16,
		borderRadius: 8,
		marginLeft: -8,
		borderWidth: 2,
		borderColor: "#FFFFFF",
	},
	times: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
	time: { fontSize: 13, fontVariant: ["tabular-nums"], minWidth: 64 },
	timeEnd: { textAlign: "right" },
	turn: { textAlign: "center", minWidth: 0 },
	speed: { fontSize: 15, fontWeight: "700" },
	transport: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 28, paddingTop: 6 },
	skip: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
	bigPlay: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
	bigPlayIcon: { fontSize: 36, lineHeight: 42, fontWeight: "800" },
	playNudge: { marginLeft: 4 },
	play: { minWidth: 48, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
	controlText: { fontSize: 15, fontWeight: "700" },
	playIcon: { fontSize: 26, lineHeight: 30, fontWeight: "800" },
});
