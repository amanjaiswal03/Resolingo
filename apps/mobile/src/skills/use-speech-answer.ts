import { useCallback, useEffect, useRef, useState } from "react";
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { File } from "expo-file-system";
import { MAX_PHRASE_AUDIO_SECONDS } from "@resolingo/shared";
import { api } from "@/services/api";
import { SPEECH_RECORDING } from "@/say/speech-recording";
import { initialVoiceActivity, stepVoiceActivity, type VadStop } from "@/say/voice-activity";
import { waitForSessionSettle } from "./audio-session-settle";

export type SpeechAnswer =
  | { kind: "heard"; heard: string }
  | { kind: "no-speech" }
  | { kind: "permission" }
  | { kind: "failed"; message: string };
type Phase = "idle" | "listening" | "checking";

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message.replace(/^\[.*?\]\s*/, "");
  }
  return "Please try again.";
}

function discard(uri: string | null | undefined) {
  if (!uri) return;
  try { new File(uri).delete(); } catch { /* already gone */ }
}

/** dBFS to 0..1 for the listening meter. */
export function meterLevel(db: number | undefined): number {
  if (db == null || !Number.isFinite(db)) return 0.12;
  return (Math.min(0, Math.max(-60, db)) + 60) / 60;
}

/**
 * Record one spoken answer, stop by itself after a pause, and transcribe it in
 * the target language. Mirrors the recording flow in Say.
 */
export function useSpeechAnswer() {
  const recorder = useAudioRecorder(SPEECH_RECORDING);
  const status = useAudioRecorderState(recorder, 120);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const finishing = useRef(false);
  const cancelled = useRef(false);
  const sawRecording = useRef(false);
  const activity = useRef(initialVoiceActivity());
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const receive = useRef<((answer: SpeechAnswer) => void) | null>(null);

  const setBoth = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const stopPoll = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  };

  const finish = useCallback(async (reason: "user" | "cancel" | VadStop) => {
    if (finishing.current || phaseRef.current !== "listening") return;
    finishing.current = true;
    stopPoll();
    const cancel = reason === "cancel" || cancelled.current;
    const { heardSpeech, sawLevel } = activity.current;
    const durationMs = Math.min(MAX_PHRASE_AUDIO_SECONDS * 1000, Math.round(recorder.getStatus().durationMillis || 0));
    const missed = !cancel && (reason === "no-speech" || (sawLevel && !heardSpeech) || durationMs < 300);
    const deliver = receive.current;
    receive.current = null;
    setBoth(cancel || missed ? "idle" : "checking");
    let uri = recorder.uri ?? recorder.getStatus().url;
    try {
      await recorder.stop().catch(() => undefined);
      uri = recorder.uri ?? recorder.getStatus().url ?? uri;
      if (cancel) return discard(uri);
      if (!uri || missed) {
        discard(uri);
        deliver?.({ kind: "no-speech" });
        return;
      }
      const audioBase64 = await new File(uri).base64();
      discard(uri);
      const result = await api.checkSpokenPhrase({ audioBase64, mimeType: "audio/m4a", durationMs });
      deliver?.({ kind: "heard", heard: result.heard });
    } catch (error) {
      discard(uri);
      const message = messageOf(error);
      if (!cancel) deliver?.(/catch|silent/i.test(message) ? { kind: "no-speech" } : { kind: "failed", message });
    } finally {
      finishing.current = false;
      cancelled.current = false;
      sawRecording.current = false;
      activity.current = initialVoiceActivity();
      setBoth("idle");
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    }
  }, [recorder]);

  useEffect(() => () => {
    stopPoll();
    receive.current = null;
    if (phaseRef.current === "listening") void recorder.stop().catch(() => undefined);
  }, [recorder]);

  const start = async (onAnswer: (answer: SpeechAnswer) => void) => {
    if (phaseRef.current !== "idle") return;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onAnswer({ kind: "permission" });
        return;
      }
      await waitForSessionSettle();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      receive.current = onAnswer;
      cancelled.current = false;
      sawRecording.current = false;
      activity.current = initialVoiceActivity();
      setBoth("listening");
      recorder.record({ forDuration: MAX_PHRASE_AUDIO_SECONDS });
      stopPoll();
      poll.current = setInterval(() => {
        if (phaseRef.current !== "listening" || finishing.current) return;
        const current = recorder.getStatus();
        if (current.isRecording) sawRecording.current = true;
        const stepped = stepVoiceActivity(activity.current, {
          durationMs: current.durationMillis,
          meteringDb: typeof current.metering === "number" ? current.metering : null,
          capMs: MAX_PHRASE_AUDIO_SECONDS * 1000,
        });
        activity.current = stepped.state;
        if (stepped.stop) void finish(stepped.stop);
        else if (sawRecording.current && !current.isRecording) void finish(activity.current.heardSpeech ? "cap" : "no-speech");
      }, 200);
    } catch (error) {
      stopPoll();
      receive.current = null;
      setBoth("idle");
      await recorder.stop().catch(() => undefined);
      onAnswer({ kind: "failed", message: messageOf(error) });
    }
  };

  return {
    phase,
    level: phase === "listening" ? meterLevel(status.metering) : 0,
    start,
    stop: () => void finish("user"),
    cancel: () => {
      cancelled.current = true;
      void finish("cancel");
    },
  };
}
