import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
	createAudioPlaylist,
	setAudioModeAsync,
	useAudioPlaylistStatus,
} from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Lesson } from "@resolingo/shared";
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
import { Button } from "./Button";
import { Body } from "./Typography";
import { useTheme } from "@/theme/tokens";

const speeds = [0.8, 1, 1.2] as const;

export function LessonPlayer({
	lesson,
	onComplete,
	onStart,
	onSegmentChange,
	jumpTo,
}: {
	lesson: Lesson;
	onComplete: () => void;
	onStart?: () => void;
	onSegmentChange?: (segmentId: string) => void;
	jumpTo?: { id: string; token: number } | null;
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
	return (
		<View
			style={[
				styles.player,
				{
					backgroundColor: theme.navy,
					paddingBottom: Math.max(8, insets.bottom),
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
				<View style={[styles.track, { backgroundColor: "#314262" }]}>
					<View
						ref={fillRef}
						collapsable={false}
						style={[
							styles.fill,
							{
								backgroundColor: theme.coral,
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
							backgroundColor: theme.coral,
							left: percentWidth(progress * 100),
						},
					]}
				/>
			</View>
			<View style={styles.times}>
				<Text ref={elapsedRef} style={styles.time}>{formatClock(shownElapsed)}</Text>
				{yourTurn ? <Body style={styles.time}>Say it aloud</Body> : null}
				<Body style={styles.time}>{formatClock(timeline.totalMs)}</Body>
			</View>
			<View style={styles.controls}>
				<Button
					label={`${speeds[speedIndex]}×`}
					variant="ghost"
					onPress={changeSpeed}
				/>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Back ten seconds"
					onPress={() => seekBy(-10)}
					style={styles.circle}
				>
					<Body style={styles.controlText}>−10</Body>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={status.playing ? "Pause" : "Play"}
					onPress={() => (status.playing ? playlist.pause() : playlist.play())}
					style={[styles.play, { backgroundColor: theme.coral }]}
				>
					<Body style={styles.playText}>{status.playing ? "Ⅱ" : "▶"}</Body>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Forward ten seconds"
					onPress={() => seekBy(10)}
					style={styles.circle}
				>
					<Body style={styles.controlText}>+10</Body>
				</Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	player: { borderRadius: 22, paddingHorizontal: 16, paddingTop: 8, gap: 2 },
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
	times: { flexDirection: "row", justifyContent: "space-between" },
	time: { color: "#9FB0CC", fontSize: 12, fontVariant: ["tabular-nums"] },
	controls: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	circle: {
		width: 40,
		height: 40,
		alignItems: "center",
		justifyContent: "center",
	},
	play: {
		width: 46,
		height: 46,
		borderRadius: 23,
		alignItems: "center",
		justifyContent: "center",
	},
	controlText: { color: "#FFFFFF", fontWeight: "700" },
	playText: { color: "#08152F", fontSize: 18, fontWeight: "800" },
});
