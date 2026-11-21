import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Alert } from "react-native";
import { usePlayback } from "@/playback/PlaybackProvider";
import { phraseAudioUrl } from "@/services/phrases";

export function useExampleAudio() {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const { pause, registerExamplePause, stopExample } = usePlayback();
  const request = useRef(0);
  const unregister = useRef<(() => void) | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => () => {
    request.current += 1;
    unregister.current?.();
  }, []);

  const stop = useCallback(() => {
    request.current += 1;
    unregister.current?.();
    unregister.current = null;
    player.pause();
    setActive(null);
    setLoading(false);
  }, [player]);

  const play = async (path: string) => {
    if (active === path && (loading || status.playing)) {
      stop();
      return;
    }
    stopExample();
    const id = ++request.current;
    player.pause();
    pause();
    unregister.current = registerExamplePause(stop);
    setActive(path);
    setLoading(true);
    try {
      const uri = await phraseAudioUrl(path);
      if (request.current !== id) return;
      player.replace({ uri });
      player.play();
    } catch {
      if (request.current === id) Alert.alert("Couldn’t play the example", "Check your connection and try again.");
    } finally {
      if (request.current === id) setLoading(false);
    }
  };

  return {
    play,
    stop,
    label: (path: string) => active === path && loading ? "Loading audio…" : active === path && status.playing ? "Pause audio" : "Hear example",
  };
}
