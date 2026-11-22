import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { Asset } from "expo-asset";
import {
	createAudioPlayer,
	setAudioModeAsync,
	useAudioPlayerStatus,
} from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { lessonDisplayText, type Lesson } from "@resolingo/shared";
import { cuesRewoundTo } from "@/lesson/answer-attempts";
import { answerPlan } from "@/lesson/answer-windows";
import { percentWidth } from "@/lesson/navigation";
import { joinLessonAudio } from "@/lesson/join-lesson-audio";
import { stopOwnedPlayer } from "@/lesson/player-lifecycle";
import { useAnswerChecks } from "@/lesson/use-answer-checks";
import {
	elapsedMs,
	formatClock,
	lessonTimeline,
	playbackClips,
	seekInTimeline,
	segmentAtClipTime,
	segmentStartInClip,
} from "@/lesson/timeline";
import { SkipIcon } from "./SkipIcon";
import { SpeakingPractice } from "./SpeakingPractice";
import { Body } from "./Typography";
import { lessonAccent } from "@/theme/colors";
import { useTheme } from "@/theme/tokens";
import { usePlayback } from "@/playback/PlaybackProvider";

const speeds = [0.8, 1, 1.2] as const;

const kindLabel = { conversation: "Conversation", grammar: "Grammar", phrase: "Phrase" } as const;
const appIcon = require("../../assets/resolingo-icon.png") as number;

const playbackMode = {
	playsInSilentMode: true,
	shouldPlayInBackground: true,
	interruptionMode: "doNotMix",
	allowsRecording: false,
} as const;

export function LessonPlayer({
	lesson,
	onComplete,
	onStart,
	onSegmentChange,
	jumpTo,
	mode = "full",
	onOpen,
	placement = "bottom",
	allowAnswerChecks = true,
}: {
	lesson: Lesson;
	onComplete: () => void;
	onStart?: () => void;
	onSegmentChange?: (segmentId: string) => void;
	jumpTo?: { id: string; token: number } | null;
	mode?: "full" | "mini";
	onOpen?: () => void;
	placement?: "top" | "bottom";
	allowAnswerChecks?: boolean;
}) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const { registerPause, stopExample } = usePlayback();
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
	const autoPlay = useRef(true);
	const completed = useRef(false);
	const alive = useRef(true);
	const generation = useRef(0);
	const trackWidth = useRef(0);
	const trackPageX = useRef(0);
	const scrubberRef = useRef<View>(null);
	const seekGeneration = useRef(0);
	const jumpToken = useRef<number | null>(null);
	const indexRef = useRef(0);
	const handledFinish = useRef(-1);
	const [clipIndex, setClipIndex] = useState(0);
	const [joined, setJoined] = useState<{ uri: string; durationsMs: number[] } | null>(null);
	const [joinFailed, setJoinFailed] = useState(false);
	const [opening, setOpening] = useState(true);
	const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
	// One player, not a queue, so the lock screen and background session stay attached
	// to the audio that is actually playing. Clips advance with replace().
	const [player] = useState(() =>
		createAudioPlayer(null, {
			updateInterval: 250,
			keepAudioSessionActive: true,
		}),
	);
	const continuous = playable.length <= 1 || joined != null;
	const sourceUri = playable.length <= 1 ? playable[0]?.audioUrl ?? null : joined?.uri ?? (joinFailed ? playable[0]?.audioUrl ?? null : null);
	const status = useAudioPlayerStatus(player);
	const checks = useMemo(
		() => joined ? answerPlan(lesson.segments, playable, joined.durationsMs) : null,
		[joined, lesson.segments, playable],
	);
	const {
		available: canCheckAnswers, enable: enableChecks, isArmed, recording, partial, skip, results,
		feedbackPlaying, cancelFeedback, state: checkState, toggle: toggleChecks, rewind: rewindChecks,
	} = useAnswerChecks(player, lesson.id, checks, status.isLoaded, allowAnswerChecks);
	const playing = status.playing || feedbackPlaying;
	const loadingAudio = playable.length > 0 && !playing && !status.error && status.playbackState !== "failed" &&
		(opening || status.timeControlStatus === "waitingToPlayAtSpecifiedRate");
	const playLabel = loadingAudio ? "Loading lesson audio" : playing ? "Pause" : "Play";
	const pauseLesson = useCallback(() => {
		autoPlay.current = false;
		setOpening(false);
		cancelFeedback();
		player.pause();
	}, [cancelFeedback, player]);
	useEffect(() => registerPause(pauseLesson), [pauseLesson, registerPause]);
	useEffect(() => {
		if (!status.playing) return;
		// eslint-disable-next-line react-hooks/set-state-in-effect -- remember that the native player has started
		setOpening(false);
		stopExample();
		if (!started.current) {
			started.current = true;
			onStart?.();
		}
	}, [onStart, status.playing, stopExample]);
	const timeline = useMemo(
		() =>
			lessonTimeline(
				playable.map((clip, index) => {
					const durationMs = joined?.durationsMs[index] ?? measuredMs[index] ?? clip.durationMs;
					return durationMs ? { durationMs } : {};
				}),
			),
		[joined, measuredMs, playable],
	);
	const fileMs = status.currentTime * 1_000;
	const fileDurationMs = status.duration * 1_000;
	const playedElapsed = continuous && fileDurationMs > 0 && timeline.totalMs > 0
		? fileMs * (timeline.totalMs / fileDurationMs)
		: elapsedMs(timeline, clipIndex, status.currentTime);
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
		const apply = () => {
			if (isArmed()) return;
			void setAudioModeAsync(playbackMode).catch(() => undefined);
		};
		apply();
		const subscription = AppState.addEventListener("change", apply);
		return () => subscription.remove();
	}, [isArmed]);
	useEffect(() => {
		if (playable.length <= 1) return;
		let cancelled = false;
		void joinLessonAudio(playable.map((clip) => {
			const audioPath = clip.segments[0]?.audioPath;
			return audioPath ? { audioUrl: clip.audioUrl, audioPath } : { audioUrl: clip.audioUrl };
		})).then((next) => {
			if (cancelled) return;
			if (next) setJoined(next);
			else setJoinFailed(true);
		}).catch(() => {
			if (!cancelled) setJoinFailed(true);
		});
		return () => { cancelled = true; };
	}, [playable]);
	useEffect(() => {
		if (!sourceUri) return;
		let cancelled = false;
		void (async () => {
			await setAudioModeAsync(playbackMode).catch(() => undefined);
			if (cancelled || !alive.current) return;
			player.replace({ uri: sourceUri });
			player.setPlaybackRate(1);
			if (!autoPlay.current) return;
			player.play();
		})();
		return () => {
			cancelled = true;
		};
	}, [player, sourceUri]);
	useEffect(() => {
		let cancelled = false;
		void Asset.fromModule(appIcon).downloadAsync().then((asset) => {
			const uri = asset.localUri ?? asset.uri;
			if (!cancelled && uri) setArtworkUrl(uri);
		}).catch(() => undefined);
		return () => { cancelled = true; };
	}, []);
	useEffect(() => {
		if (!status.isLoaded) return;
		try {
			player.setActiveForLockScreen(true, {
				title: lesson.title,
				artist: "Resolingo",
				albumTitle: kindLabel[lesson.type],
				...(artworkUrl ? { artworkUrl } : {}),
			}, { showSeekForward: true, showSeekBackward: true });
		} catch {
			// The installed dev client was built before lock-screen controls existed.
		}
	}, [artworkUrl, lesson.title, lesson.type, player, status.isLoaded]);
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
		cancelFeedback();
		completed.current = false;
		scrubbingRef.current = false;
		scrubRatioRef.current = null;
		// eslint-disable-next-line react-hooks/set-state-in-effect -- drop the scrub preview when an external jump is applied
		setScrubLock((lock) => lock + 1);
		const offsetSec = segmentStartInClip(clip, jumpTo.id, timeline.durationsMs[index]) / 1_000;
		if (continuous) {
			const targetMs = (timeline.startsMs[index] ?? 0) + offsetSec * 1_000;
			const durationSec = status.duration > 0 ? status.duration : timeline.totalMs / 1_000;
			void player.seekTo(timeline.totalMs > 0 ? (targetMs / timeline.totalMs) * durationSec : offsetSec);
		} else {
			if (index !== indexRef.current) {
				indexRef.current = index;
				setClipIndex(index);
				player.replace({ uri: clip.audioUrl });
			}
			void player.seekTo(offsetSec);
		}
		player.play();
	}, [cancelFeedback, continuous, jumpTo, playable, player, status.duration, timeline.durationsMs, timeline.startsMs, timeline.totalMs]);
	useEffect(() => {
		if (!status.isLoaded || status.duration <= 0) return;
		const durationMs = Math.round(status.duration * 1_000);
		// eslint-disable-next-line react-hooks/set-state-in-effect -- record the loaded clip length for the timeline
		setMeasuredMs((currentMs) =>
			currentMs[clipIndex] === durationMs
				? currentMs
				: { ...currentMs, [clipIndex]: durationMs },
		);
	}, [clipIndex, status.duration, status.isLoaded]);
	useEffect(() => {
		const nearEnd = status.duration > 0 && status.currentTime >= status.duration - 0.25;
		if (!nearEnd && status.currentTime > 0.3) handledFinish.current = -1;
		if (!alive.current || !status.didJustFinish) return;
		if (continuous) {
			if (completed.current) return;
			completed.current = true;
			onComplete();
			return;
		}
		const index = indexRef.current;
		if (handledFinish.current === index) return;
		handledFinish.current = index;
		const next = playable[index + 1];
		if (next) {
			handledFinish.current = index + 1;
			indexRef.current = index + 1;
			setClipIndex(index + 1);
			player.replace({ uri: next.audioUrl });
			player.play();
			return;
		}
		if (completed.current) return;
		completed.current = true;
		onComplete();
	}, [continuous, onComplete, playable, player, status.currentTime, status.didJustFinish, status.duration]);
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
	const seekToLessonMs = (targetMs: number) => {
		if (timeline.totalMs <= 0) return;
		rewindChecks(cuesRewoundTo(checks?.windows ?? [], targetMs / 1_000));
		completed.current = false;
		const target = seekInTimeline(timeline, targetMs);
		const clip = playable[target.index];
		if (!clip) return;
		const generation = ++seekGeneration.current;
		if (continuous) {
			const durationSec = status.duration > 0 ? status.duration : timeline.totalMs / 1_000;
			if (feedbackPlaying) cancelFeedback();
			void player.seekTo((targetMs / timeline.totalMs) * durationSec).then(() => {
				if (feedbackPlaying && alive.current) player.play();
			}).catch(() => undefined);
			return;
		}
		void (async () => {
			// Replacing the clip starts at time zero, and a seek issued in that
			// same moment is dropped. Retry until the new clip accepts the position.
			if (target.index !== indexRef.current) {
				indexRef.current = target.index;
				setClipIndex(target.index);
				player.replace({ uri: clip.audioUrl });
			}
			for (let attempt = 0; attempt < 6; attempt += 1) {
				if (seekGeneration.current !== generation) return;
				await player.seekTo(target.offsetSec);
				if (seekGeneration.current !== generation) return;
				const landed = indexRef.current === target.index && Math.abs(player.currentTime - target.offsetSec) < 0.35;
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
	const activeLine = shown?.segments.find((segment) => segment.id === activeSegmentId);
	const lineText = activeLine ? lessonDisplayText(activeLine.text) : "";
	const toggle = () => {
		if (playing) {
			pauseLesson();
			return;
		}
		autoPlay.current = true;
		if (sourceUri) player.play();
		else if (playable.length > 0) setOpening(true);
	};
	const playSegmentInLesson = (segmentId: string) => {
		const index = playable.findIndex((clip) => clip.segmentIds.includes(segmentId));
		const start = timeline.startsMs[index];
		if (start == null || !continuous || timeline.totalMs <= 0) return;
		rewindChecks(cuesRewoundTo(checks?.windows ?? [], start / 1_000));
		const duration = status.duration > 0 ? status.duration : timeline.totalMs / 1_000;
		completed.current = false;
		pauseLesson();
		void player.seekTo(start / timeline.totalMs * duration, 0, 0).then(() => {
			if (alive.current) player.play();
		}).catch(() => undefined);
	};
	if (mode === "mini") {
		return (
			<View style={[styles.mini, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
				<View style={[styles.miniTrack, { backgroundColor: theme.border }]}>
					<View style={[styles.miniFill, { backgroundColor: theme.brand, width: percentWidth(progress * 100) }]} />
				</View>
				<View style={styles.miniRow}>
					<Pressable accessibilityRole="button" accessibilityLabel={`Open ${lesson.title}`} onPress={onOpen} style={styles.miniOpen}>
						<Text style={[styles.miniChevron, { color: theme.text }]}>⌃</Text>
						<View style={[styles.miniBadge, { backgroundColor: lessonAccent(theme, lesson.type) }]}>
							<Body style={styles.miniBadgeText}>{lesson.type.slice(0, 1).toUpperCase()}</Body>
						</View>
						<View style={styles.miniCopy}>
							<Text numberOfLines={1} style={[styles.miniTitle, { color: theme.text }]}>{lineText || lesson.title}</Text>
							<Text numberOfLines={1} style={[styles.miniSubtitle, { color: theme.textMuted }]}>{lineText ? lesson.title : kindLabel[lesson.type]}</Text>
						</View>
					</Pressable>
					<Pressable accessibilityRole="button" accessibilityLabel={playLabel} accessibilityState={{ busy: loadingAudio }} disabled={loadingAudio} onPress={toggle} style={styles.play}>
						{loadingAudio ? <ActivityIndicator color={theme.primary} /> : <Text style={[styles.playIcon, { color: theme.primary }]}>{playing ? "Ⅱ" : "▶"}</Text>}
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
								backgroundColor: theme.brand,
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
							backgroundColor: theme.brand,
							borderColor: theme.surface,
							left: percentWidth(progress * 100),
						},
					]}
				/>
			</View>
			<View style={styles.times}>
				<Text ref={elapsedRef} style={[styles.time, { color: theme.textMuted }]}>{formatClock(shownElapsed)}</Text>
				<Pressable accessibilityRole="button" accessibilityLabel="Playback speed" onPress={changeSpeed} hitSlop={8}>
					<Text style={[styles.speed, { color: theme.text }]}>{speeds[speedIndex]}×</Text>
				</Pressable>
				<Text style={[styles.time, styles.timeEnd, { color: theme.textMuted }]}>{formatClock(timeline.totalMs)}</Text>
			</View>
			<View style={styles.transport}>
				<Pressable accessibilityRole="button" accessibilityLabel="Back ten seconds" onPress={() => seekBy(-10)} style={styles.skip}>
					<SkipIcon direction="back" color={theme.text} />
				</Pressable>
				<Pressable accessibilityRole="button" accessibilityLabel={playLabel} accessibilityState={{ busy: loadingAudio }} disabled={loadingAudio} onPress={toggle} style={[styles.bigPlay, { backgroundColor: theme.primaryFill }]}>
					{loadingAudio ? <ActivityIndicator size="large" color={theme.onPrimary} /> : <Text style={[styles.bigPlayIcon, { color: theme.onPrimary }, !playing && styles.playNudge]}>{playing ? "Ⅱ" : "▶"}</Text>}
				</Pressable>
				<Pressable accessibilityRole="button" accessibilityLabel="Forward ten seconds" onPress={() => seekBy(10)} style={styles.skip}>
					<SkipIcon direction="forward" color={theme.text} />
				</Pressable>
			</View>
			{checks && (canCheckAnswers || Object.keys(results).length > 0) ? (
				<SpeakingPractice
					plan={checks}
					available={canCheckAnswers}
					state={checkState}
					recording={recording !== null}
					partial={partial}
					results={results}
					onToggle={toggleChecks}
					onSkip={recording ? skip : undefined}
					onPauseLesson={pauseLesson}
					onPlayInLesson={playSegmentInLesson}
					onRetry={(id, close) => enableChecks(() => { close(); playSegmentInLesson(id); })}
				/>
			) : null}
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
	speed: { fontSize: 15, fontWeight: "700" },
	transport: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 28, paddingTop: 6 },
	skip: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
	bigPlay: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
	bigPlayIcon: { fontSize: 36, lineHeight: 42, fontWeight: "800" },
	playNudge: { marginLeft: 4 },
	play: { minWidth: 48, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
	playIcon: { fontSize: 26, lineHeight: 30, fontWeight: "800" },
});
