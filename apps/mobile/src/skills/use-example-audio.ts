import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Alert } from "react-native";
import { usePlayback } from "@/playback/PlaybackProvider";
import { notePlaybackPaused } from "./audio-session-settle";
import { cachedPhraseAudio, prefetchPhraseAudio } from "./phrase-audio-cache";

export type ExampleAudioState = "idle" | "loading" | "playing";

export function exampleAudioLabel(state: ExampleAudioState): string {
  return state === "loading" ? "Loading audio…" : state === "playing" ? "Pause audio" : "Hear example";
}

export function useExampleAudio() {
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const { pause, registerExamplePause, stopExample } = usePlayback();
  const request = useRef(0);
  const unregister = useRef<(() => void) | null>(null);
  const [active, setActive] = useState<string | null>(null);
  // True from the tap until sound actually comes out, so the button shows a spinner while it fetches and buffers.
  const [waiting, setWaiting] = useState(false);

  useEffect(() => () => {
    request.current += 1;
    unregister.current?.();
  }, []);

  // Clear the spinner once sound comes out, and the active clip once it ends.
  useEffect(() => {
    const subscription = player.addListener("playbackStatusUpdate", (update) => {
      if (update.playing) setWaiting(false);
      if (update.didJustFinish) {
        notePlaybackPaused();
        setWaiting(false);
        setActive(null);
      }
    });
    return () => subscription.remove();
  }, [player]);

  const stop = useCallback(() => {
    request.current += 1;
    unregister.current?.();
    unregister.current = null;
    // Pausing an idle player still releases the audio session a moment later, which can cut off a
    // recording that starts right after. Only pause when something is playing.
    if (player.playing) {
      player.pause();
      notePlaybackPaused();
    }
    setActive(null);
    setWaiting(false);
  }, [player]);

  const stateOf = (path: string): ExampleAudioState => {
    if (active !== path) return "idle";
    if (waiting) return "loading";
    return status.playing ? "playing" : "idle";
  };

  const play = async (path: string) => {
    if (stateOf(path) !== "idle") {
      stop();
      return;
    }
    stopExample();
    const id = ++request.current;
    if (player.playing) player.pause();
    pause();
    unregister.current = registerExamplePause(stop);
    setActive(path);
    setWaiting(true);
    try {
      const uri = await cachedPhraseAudio(path);
      if (request.current !== id) return;
      player.replace({ uri });
      player.play();
    } catch {
      if (request.current !== id) return;
      setWaiting(false);
      setActive(null);
      Alert.alert("Couldn’t play the example", "Check your connection and try again.");
    }
  };

  // A clip that never starts (a bad file, a dropped stream) must not leave the spinner on forever.
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(stop, 15_000);
    return () => clearTimeout(timer);
  }, [waiting, stop]);

  return {
    play,
    stop,
    prefetch: prefetchPhraseAudio,
    state: stateOf,
    label: (path: string) => exampleAudioLabel(stateOf(path)),
  };
}
