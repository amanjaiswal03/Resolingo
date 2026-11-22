import { checkedSpeakingBonusMs, languageById, speakingPauseMs } from "@resolingo/shared";
import { requireOptionalNativeModule, type NativeModule } from "expo";
import { requestRecordingPermissionsAsync, type AudioPlayer } from "expo-audio";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { api, type LessonVoiceClips } from "@/services/api";
import { clearAttemptsFrom, reduceAnswerAttempts, type AnswerAttemptEvent } from "./answer-attempts";
import type { AnswerPlan, AnswerWindow } from "./answer-windows";
import { decideAttempt, type VoiceResult, type VoiceVerdict } from "./phrase-match";

type AnswerEvent = { sessionId: string; id: string; captureId?: string; verdict: VoiceVerdict; heard?: string };
type GradeEvent = {
  sessionId: string;
  id: string;
  captureId?: string;
  heard?: string;
  alternate?: string;
  audibleSeconds?: number;
  confidenceKnown?: boolean;
  wasQuiet?: boolean;
};
type WindowEvent = {
  sessionId: string;
  id: string;
  captureId?: string;
  recording: boolean;
  state?: "recording" | "cancelled" | "skipped" | "checking" | "unclear";
};
type AnswerEvents = {
  onAnswer: (event: AnswerEvent) => void;
  onGrade: (event: GradeEvent) => void;
  onWindow: (event: WindowEvent) => void;
  onFeedback: (event: { sessionId: string; playing: boolean }) => void;
  onStopped: (event: { sessionId: string }) => void;
};
type CheckedWindow = AnswerWindow & { responseSeconds: number; extraSeconds: number };
type NativeChecks = InstanceType<typeof NativeModule<AnswerEvents>> & {
  supports(language: string): boolean;
  prepare?(language: string): Promise<"legacy" | "dictation" | "unsupported" | "setupFailed">;
  requestSpeechPermission(): Promise<boolean>;
  start(player: AudioPlayer, id: string, language: string, windows: CheckedWindow[]): Promise<void>;
  installFeedback?(id: string, clips: LessonVoiceClips): Promise<void>;
  cancelFeedback?(id: string, resume: boolean): Promise<void>;
  abandon?(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  speak?(sessionId: string, captureId: string, verdict: string): Promise<void>;
};

const native = Platform.OS === "ios" ? requireOptionalNativeModule<NativeChecks>("LessonVoiceCheck") : null;

export function useAnswerChecks(player: AudioPlayer, lessonId: string, plan: AnswerPlan | null, loaded: boolean, allowed: boolean) {
  const session = useRef<string | null>(null);
  const starting = useRef(false);
  const mounted = useRef(false);
  const allowedHere = useRef(allowed);
  const planRef = useRef(plan);
  const [state, setState] = useState<"off" | "starting" | "on">("off");
  const [results, setResults] = useState<Record<string, VoiceResult>>({});
  const [recording, setRecording] = useState<string | null>(null);
  const [feedbackPlaying, setFeedbackPlaying] = useState(false);
  const feedbackClips = useRef<Promise<LessonVoiceClips | null> | null>(null);
  const attempts = useRef<Record<string, string>>({});
  const resultsRef = useRef(results);

  useEffect(() => { planRef.current = plan; }, [plan]);

  useEffect(() => {
    mounted.current = true;
    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    const clearPending = (id: string) => {
      const timeout = pending.get(id);
      if (timeout !== undefined) clearTimeout(timeout);
      pending.delete(id);
    };
    const apply = (event: AnswerAttemptEvent) => {
      const next = reduceAnswerAttempts({ attempts: attempts.current, results: resultsRef.current }, event);
      attempts.current = next.attempts;
      resultsRef.current = next.results;
      setResults(next.results);
    };
    const grade = native?.addListener("onGrade", (event) => {
      if (session.current !== event.sessionId || !event.captureId) return;
      const plan = planRef.current;
      const expected = plan?.windows.find(({ id }) => id === event.id)?.expected;
      if (!plan || !expected) return;
      clearPending(event.id);
      const decision = decideAttempt({
        expected,
        heard: event.heard,
        alternate: event.alternate,
        language: plan.language,
        audibleSeconds: event.audibleSeconds ?? 0,
        confidenceKnown: event.confidenceKnown === true,
        wasQuiet: event.wasQuiet === true,
      });
      apply({ type: "answer", id: event.id, captureId: event.captureId, result: decision.result });
      void native?.speak?.(event.sessionId, event.captureId, decision.clip).catch(() => undefined);
    });
    const subscription = native?.addListener("onAnswer", (event) => {
      if (session.current !== event.sessionId || !event.captureId) return;
      clearPending(event.id);
      apply({
        type: "answer",
        id: event.id,
        captureId: event.captureId,
        result: { verdict: event.verdict, ...(event.heard ? { heard: event.heard } : {}) },
      });
    });
    const window = native?.addListener("onWindow", (event) => {
      if (session.current !== event.sessionId) return;
      setRecording((current) => event.recording ? event.id : current === event.id ? null : current);
      if (event.state === "cancelled") {
        clearPending(event.id);
        apply({ type: "cancelled", id: event.id });
        return;
      }
      if (event.recording) {
        if (!event.captureId) return;
        clearPending(event.id);
        apply({ type: "recording", id: event.id, captureId: event.captureId });
        return;
      }
      if (!event.captureId) return;
      if (event.state === "skipped" || event.state === "unclear") {
        clearPending(event.id);
        apply({ type: "status", id: event.id, captureId: event.captureId, result: { verdict: event.state } });
        return;
      }
      if (!event.state) {
        // Older builds signal a closed mic without stating whether the pause ended.
        const end = planRef.current?.windows.find(({ id }) => id === event.id)?.endSeconds;
        const time = player.currentTime;
        if (end == null || time < end - 0.05 || time > end + 0.4) return;
      }
      clearPending(event.id);
      apply({ type: "status", id: event.id, captureId: event.captureId, result: { verdict: "checking" } });
      const captureId = event.captureId;
      pending.set(event.id, setTimeout(() => {
        pending.delete(event.id);
        if (attempts.current[event.id] !== captureId || resultsRef.current[event.id]?.verdict !== "checking") return;
        apply({ type: "status", id: event.id, captureId, result: { verdict: "unclear" } });
      }, 4_500));
    });
    const stopped = native?.addListener("onStopped", (event) => {
      if (session.current !== event.sessionId) return;
      session.current = null;
      setRecording(null);
      setFeedbackPlaying(false);
      setState("off");
    });
    const feedback = native?.installFeedback && native.addListener("onFeedback", (event) => {
      if (session.current === event.sessionId) setFeedbackPlaying(event.playing);
    });
    return () => {
      mounted.current = false;
      for (const timeout of pending.values()) clearTimeout(timeout);
      grade?.remove();
      subscription?.remove();
      window?.remove();
      stopped?.remove();
      feedback?.remove();
      const id = session.current;
      session.current = null;
      if (id) void native?.stop(id).catch(() => undefined);
    };
  }, [player]);

  useEffect(() => {
    allowedHere.current = allowed;
    const id = session.current;
    if (allowed || !id || !native) return;
    session.current = null;
    void native.stop(id).catch(() => undefined).finally(() => {
      if (mounted.current && !session.current) {
        setRecording(null);
        setFeedbackPlaying(false);
        setState("off");
      }
    });
  }, [allowed]);

  const isArmed = useCallback(() => session.current !== null, []);
  const rewind = useCallback((ids: readonly string[]) => {
    const id = session.current;
    if (id) void native?.abandon?.(id).catch(() => undefined);
    const next = clearAttemptsFrom({ attempts: attempts.current, results: resultsRef.current }, ids);
    attempts.current = next.attempts;
    resultsRef.current = next.results;
    setResults(next.results);
  }, []);
  const cancelFeedback = useCallback(() => {
    const id = session.current;
    if (id) void native?.cancelFeedback?.(id, false).catch(() => undefined);
  }, []);
  const start = async (currentPlan: AnswerPlan, onEnabled?: () => void) => {
    if (!native || !mounted.current || !allowedHere.current || starting.current || session.current) return;
    starting.current = true;
    const id = randomUUID();
    session.current = id;
    let enabled = false;
    setState("starting");
    try {
      if (native.installFeedback && !feedbackClips.current) {
        feedbackClips.current = api.lessonVoiceFeedback(lessonId).catch(() => {
          feedbackClips.current = null;
          return null;
        });
      }
      const speech = native.prepare
        ? await native.prepare(currentPlan.language)
        : native.supports(currentPlan.language) ? "legacy" : "unsupported";
      if (session.current !== id) return;
      if (speech === "setupFailed") {
        Alert.alert("Speech setup couldn’t finish", "Connect to Wi-Fi and try turning on answer checking again.");
        return;
      }
      if (speech === "unsupported") {
        const language = languageById[currentPlan.language].label;
        Alert.alert(
          "On-device speech is unavailable",
          `Try adding the ${language} keyboard and turning on Enable Dictation in Settings › General › Keyboard. Dictate a sentence using that keyboard, then try again.`,
        );
        return;
      }
      const mic = await requestRecordingPermissionsAsync();
      if (session.current !== id) return;
      const allowed = mic.granted && (speech === "dictation" || await native.requestSpeechPermission());
      if (session.current !== id) return;
      if (!allowed) {
        Alert.alert("Answer checking is off", "Allow microphone and speech recognition access in Settings to check spoken answers.");
        return;
      }
      const windows = currentPlan.windows.map(({ id, startSeconds, endSeconds, expected, feedbackAtSeconds }) => {
        const baseline = speakingPauseMs(expected, currentPlan.language);
        return {
          id, startSeconds, endSeconds, feedbackAtSeconds, expected,
          responseSeconds: baseline / 1_000,
          extraSeconds: checkedSpeakingBonusMs(baseline) / 1_000,
        };
      });
      await native.start(player, id, currentPlan.language, windows);
      if (session.current !== id) {
        await native.stop(id);
        return;
      }
      enabled = true;
      setState("on");
      void feedbackClips.current?.then((clips) => {
        if (session.current === id && clips) return native.installFeedback?.(id, clips);
      }).catch(() => undefined);
      onEnabled?.();
    } catch {
      if (session.current === id) Alert.alert("Answer checking is unavailable", "You can keep listening and hear each model answer.");
    } finally {
      starting.current = false;
      if (session.current === id && !enabled) {
        session.current = null;
        setState("off");
      }
    }
  };

  const enable = (onEnabled?: () => void) => {
    if (!native || !plan || !loaded || !allowedHere.current || starting.current) return;
    if (session.current) {
      onEnabled?.();
      return;
    }
    Alert.alert(
      "Check my answers?",
      "Speak after the tone for brief feedback, or let the pause pass. You can review your answers later. Your voice stays on this iPhone. The first setup may download a speech model.",
      [{ text: "Cancel", style: "cancel" }, { text: "Turn on", onPress: () => void start(plan, onEnabled) }],
    );
  };

  const toggle = () => {
    if (!native || starting.current) return;
    if (session.current) {
      const id = session.current;
      session.current = null;
      setRecording(null);
      setFeedbackPlaying(false);
      setState("off");
      // Turning checking off during a narrator line should resume the lesson.
      void Promise.resolve(native.cancelFeedback?.(id, true)).catch(() => undefined)
        .then(() => native.stop(id)).catch(() => undefined);
      return;
    }
    enable();
  };

  return {
    available: Boolean(native && allowed && plan && (loaded || state !== "off")),
    state,
    toggle,
    enable,
    isArmed,
    rewind,
    recording,
    feedbackPlaying,
    cancelFeedback,
    results,
  };
}
