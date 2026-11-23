import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Alert } from "react-native";
import { usePlayback } from "@/playback/PlaybackProvider";
import { phraseAudioUrl } from "@/services/phrases";
import { notePlaybackPaused, waitForSessionSettle } from "./audio-session-settle";
import { cachedPhraseAudio, forgetPhraseAudio, prefetchPhraseAudio } from "./phrase-audio-cache";

export type ExampleAudioState = "idle" | "loading" | "playing";

/** How often to nudge a clip that has not started yet. */
export const KICK_MS = 700;
/** Give up on a clip that never starts. */
export const GIVE_UP_MS = 12_000;

export function exampleAudioLabel(state: ExampleAudioState): string {
  return state === "loading" ? "Loading audio…" : state === "playing" ? "Pause audio" : "Hear example";
}

function failed(update: { error?: string | null; playbackState?: string }): boolean {
  return Boolean(update.error) || update.playbackState === "failed";
}

export function useExampleAudio() {
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const { pause, registerExamplePause, stopExample } = usePlayback();
  const request = useRef(0);
  const unregister = useRef<(() => void) | null>(null);
  // What is loaded right now, so a failed cached file can fall back to streaming once.
  const source = useRef<{ id: number; path: string; local: boolean } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  // True from the tap until sound actually comes out, so the button shows a spinner while it fetches and buffers.
  const [waiting, setWaiting] = useState(false);

  useEffect(() => () => {
    request.current += 1;
    unregister.current?.();
  }, []);

  const stop = useCallback(() => {
    request.current += 1;
    source.current = null;
    unregister.current?.();
    unregister.current = null;
    // Pausing on iOS releases the audio session a moment later, which can silence whatever starts next.
    // Only pause when something is playing, and note it so the next start waits that moment out.
    if (player.playing) {
      player.pause();
      notePlaybackPaused();
    }
    setActive(null);
    setWaiting(false);
  }, [player]);

  const giveUp = useCallback((id: number) => {
    if (request.current !== id) return;
    stop();
    Alert.alert("Couldn’t play the example", "Check your connection and try again.");
  }, [stop]);

  const start = useCallback(async (id: number, uri: string) => {
    await waitForSessionSettle();
    if (request.current !== id) return;
    player.replace({ uri });
    player.play();
  }, [player]);

  // Clear the spinner once sound comes out, the clip once it ends, and recover from a file that won't load.
  useEffect(() => {
    const subscription = player.addListener("playbackStatusUpdate", (update) => {
      if (update.playing) setWaiting(false);
      if (update.didJustFinish) {
        notePlaybackPaused();
        source.current = null;
        setWaiting(false);
        setActive(null);
      }
      const current = source.current;
      if (!current || current.id !== request.current || !failed(update)) return;
      source.current = null;
      if (!current.local) return giveUp(current.id);
      // A cached copy that won't play is dropped and the clip is streamed instead.
      forgetPhraseAudio(current.path);
      void phraseAudioUrl(current.path).then((url) => {
        if (request.current !== current.id) return;
        source.current = { id: current.id, path: current.path, local: false };
        return start(current.id, url);
      }).catch(() => giveUp(current.id));
    });
    return () => subscription.remove();
  }, [player, giveUp, start]);

  // iOS can switch the audio session off just as a clip starts (another player paused a moment earlier).
  // The clip then waits forever. Nudging play again turns the session back on; after a while, give up.
  useEffect(() => {
    if (!waiting) return;
    const id = request.current;
    const kick = setInterval(() => {
      if (request.current === id && source.current?.id === id && !player.playing) player.play();
    }, KICK_MS);
    const timer = setTimeout(() => giveUp(id), GIVE_UP_MS);
    return () => {
      clearInterval(kick);
      clearTimeout(timer);
    };
  }, [waiting, player, giveUp]);

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
    if (player.playing) {
      player.pause();
      notePlaybackPaused();
    }
    pause();
    unregister.current = registerExamplePause(stop);
    setActive(path);
    setWaiting(true);
    try {
      const uri = await cachedPhraseAudio(path);
      if (request.current !== id) return;
      source.current = { id, path, local: uri.startsWith("file:") };
      await start(id, uri);
    } catch {
      giveUp(id);
    }
  };

  return {
    play,
    stop,
    prefetch: prefetchPhraseAudio,
    state: stateOf,
    label: (path: string) => exampleAudioLabel(stateOf(path)),
  };
}
