import { Modality } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { speechSpans } from "@resolingo/shared";
import {
  cloudCachePath,
  cloudLanguageCode,
  cloudSynthesis,
  concatPcm16,
  geminiFallbackFields,
  geminiSpeechRequest,
  pcmDurationMs,
  pcmPayload,
  renderLessonAudio,
  roleVoices,
  toPlayableAudio,
  wrapPcm16AsWav,
} from "./speech.js";

function speechConfig(request: ReturnType<typeof geminiSpeechRequest>) {
  const config = request.config.speechConfig;
  if (!config || typeof config === "string") throw new Error("expected a speech config object");
  return config;
}

describe("Gemini speech requests", () => {
  it("uses the 3.1 Flash TTS model, a tutor voice, and a style direction", () => {
    const request = geminiSpeechRequest({
      speaker: "teacher",
      language: "de-DE",
      text: "Sehr gut.",
      delivery: "praise",
      level: "A1",
    });
    const speech = speechConfig(request);
    expect(request.model).toBe("gemini-3.1-flash-tts-preview");
    expect(request.contents).toContain("excited praise");
    expect(request.contents).toContain("[excited] Sehr gut.");
    expect(request.contents).toContain("native speaker of German");
    expect(request.contents).toContain("more slowly");
    expect(request.config.responseModalities).toEqual([Modality.AUDIO]);
    expect(speech.voiceConfig?.prebuiltVoiceConfig?.voiceName).toBe(roleVoices.teacher);
    expect(speech.multiSpeakerVoiceConfig).toBeUndefined();
    expect(speech.languageCode).toBe("de-de");
  });

  it("assigns the two dialogue voices through the native multi-speaker config", () => {
    const request = geminiSpeechRequest({
      speaker: "speakerB",
      language: "en-US",
      text: "Could we try that again?",
      delivery: "curious",
      level: "B2",
    });
    const speech = speechConfig(request);
    expect(request.contents).toContain("Only SpeakerB speaks.");
    expect(request.contents).toContain("curious question");
    expect(request.contents).toContain("natural conversational pace");
    const speakers = speech.multiSpeakerVoiceConfig?.speakerVoiceConfigs ?? [];
    expect(speakers.map((speaker) => speaker.speaker)).toEqual(["SpeakerA", "SpeakerB"]);
    expect(speakers.map((speaker) => speaker.voiceConfig?.prebuiltVoiceConfig?.voiceName)).toEqual([
      roleVoices.speakerA,
      roleVoices.speakerB,
    ]);
    expect(speech.voiceConfig).toBeUndefined();
  });

  it("keeps Arabic on ar-XA for both Cloud TTS and Gemini", () => {
    expect(cloudLanguageCode("ar-EG")).toBe("ar-XA");
    const request = geminiSpeechRequest({
      speaker: "teacher",
      language: "ar-EG",
      text: "مرحبا",
      delivery: "clear",
      level: "A1",
    });
    expect(speechConfig(request).languageCode).toBe("ar-xa");
    expect(request.contents).toContain("short natural pause");
    expect(cloudSynthesis({ language: "ar-EG", level: "A1", pcm: true })).toMatchObject({
      languageCode: "ar-XA",
      audioEncoding: "LINEAR16",
      sampleRateHertz: 24_000,
    });
  });

  it("pronounces a target phrase in the tutor voice and a native phrase in the dialogue voice", () => {
    const teacherSpans = speechSpans("Say [[lang:de-DE]]Guten Tag[[/lang]] please.", "en-US");
    const target = teacherSpans[1]!;
    const tutor = geminiSpeechRequest({
      speaker: "teacher",
      language: target.language,
      text: target.text,
      delivery: "clear",
      level: "A1",
    });
    expect(target).toEqual({ language: "de-DE", text: "Guten Tag" });
    expect(speechConfig(tutor).languageCode).toBe("de-de");
    expect(speechConfig(tutor).voiceConfig?.prebuiltVoiceConfig?.voiceName).toBe(roleVoices.teacher);

    const speakerSpans = speechSpans("Das heißt [[lang:en-US]]please[[/lang]].", "de-DE");
    const native = speakerSpans[1]!;
    const dialogue = geminiSpeechRequest({
      speaker: "speakerA",
      language: native.language,
      text: native.text,
      delivery: "warm",
      level: "A2",
    });
    expect(native).toEqual({ language: "en-US", text: "please." });
    expect(speechConfig(dialogue).languageCode).toBe("en-us");
    expect(dialogue.contents).toContain("native speaker of English (US)");
    expect(dialogue.contents).toContain("Only SpeakerA speaks.");
    const speakers = speechConfig(dialogue).multiSpeakerVoiceConfig?.speakerVoiceConfigs ?? [];
    expect(speakers.map((speaker) => speaker.voiceConfig?.prebuiltVoiceConfig?.voiceName)).toEqual([
      roleVoices.speakerA,
      roleVoices.speakerB,
    ]);
  });

  it("records the segment kind and the Gemini error when speech falls back", () => {
    expect(geminiFallbackFields({
      segmentId: "intro",
      kind: "narration",
      speaker: "teacher",
      language: "en-US",
      delivery: "warm",
      error: new Error("TTS_EMPTY_AUDIO"),
    })).toEqual({
      segmentId: "intro",
      segmentKind: "narration",
      speaker: "teacher",
      language: "en-US",
      delivery: "warm",
      message: "TTS_EMPTY_AUDIO",
    });
  });

  it("changes the cache key when the line, voice, or style changes", () => {
    const base = geminiSpeechRequest({
      speaker: "speakerA",
      language: "fr-FR",
      text: "Bonjour",
      delivery: "warm",
      level: "B1",
    });
    const otherLine = geminiSpeechRequest({ ...base, speaker: "speakerA", language: "fr-FR", text: "Bonsoir", delivery: "warm", level: "B1" });
    const otherStyle = geminiSpeechRequest({ ...base, speaker: "speakerA", language: "fr-FR", text: "Bonjour", delivery: "playful", level: "B1" });
    const otherVoice = geminiSpeechRequest({ ...base, speaker: "teacher", language: "fr-FR", text: "Bonjour", delivery: "warm", level: "B1" });
    expect(base.cachePath).toMatch(/^tts-cache\/[a-f0-9]{64}\.wav$/);
    expect(new Set([base.cachePath, otherLine.cachePath, otherStyle.cachePath, otherVoice.cachePath]).size).toBe(4);
    expect(cloudCachePath({ voiceName: "ar-XA-Wavenet-A", languageCode: "ar-XA", speakingRate: 0.78, text: "مرحبا" }))
      .toMatch(/^tts-cache\/[a-f0-9]{64}\.mp3$/);
  });
});

describe("cached synthesis", () => {
  const request = geminiSpeechRequest({
    speaker: "teacher",
    language: "en-US",
    text: "Hello",
    delivery: "warm",
    level: "A2",
  });

  it("reuses a cached clip without calling either speech API", async () => {
    const gemini = vi.fn();
    const cloud = vi.fn();
    const rendered = await renderLessonAudio({
      request,
      load: async () => ({ durationMs: 1200 }),
      store: async () => undefined,
      synthesizeGemini: gemini,
      cloud,
    });
    expect(rendered).toEqual({ cachePath: request.cachePath, durationMs: 1200, extension: "wav", engine: "gemini" });
    expect(gemini).not.toHaveBeenCalled();
    expect(cloud).not.toHaveBeenCalled();
  });

  it("stores Gemini PCM as WAV and falls back to Cloud TTS when Gemini fails", async () => {
    const stored: string[] = [];
    const pcm = Buffer.alloc(480);
    const saved = await renderLessonAudio({
      request,
      load: async () => null,
      store: async (path) => { stored.push(path); },
      synthesizeGemini: async () => ({ data: pcm.toString("base64"), mimeType: "audio/pcm" }),
      cloud: async () => ({ cachePath: "tts-cache/cloud.mp3", durationMs: 900 }),
    });
    expect(stored).toEqual([request.cachePath]);
    expect(saved.extension).toBe("wav");
    expect(saved.durationMs).toBe(10);
    expect(pcmDurationMs(pcm.length)).toBe(10);

    const fallback = await renderLessonAudio({
      request,
      load: async () => null,
      store: async () => undefined,
      synthesizeGemini: async () => { throw new Error("TTS_EMPTY_AUDIO"); },
      cloud: async () => ({ cachePath: "tts-cache/cloud.mp3", durationMs: 900 }),
    });
    expect(fallback.engine).toBe("cloud-tts");
    expect(fallback.extension).toBe("mp3");
    expect(fallback.cachePath).toBe("tts-cache/cloud.mp3");
  });
});

describe("PCM wrapping", () => {
  it("wraps 24 kHz 16-bit mono PCM as a WAV expo-audio can play", () => {
    const pcm = Buffer.alloc(48_000);
    const wav = wrapPcm16AsWav(pcm);
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.length).toBe(pcm.length + 44);
    expect(pcmPayload(wav).equals(pcm)).toBe(true);
    const joined = concatPcm16([Buffer.alloc(4), Buffer.alloc(4)], 0);
    expect(joined.length).toBe(8);
    const playable = toPlayableAudio({ data: pcm.toString("base64"), mimeType: "audio/pcm" });
    expect(playable.contentType).toBe("audio/wav");
    expect(playable.durationMs).toBe(1_000);
    expect(pcmDurationMs(pcm.length)).toBe(1_000);
  });

  it("leaves an existing WAV payload untouched", () => {
    const wav = wrapPcm16AsWav(Buffer.alloc(4));
    const playable = toPlayableAudio({ data: wav.toString("base64"), mimeType: "audio/wav" });
    expect(playable.bytes.equals(wav)).toBe(true);
  });
});
