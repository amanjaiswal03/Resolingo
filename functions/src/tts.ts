import textToSpeech, { protos } from "@google-cloud/text-to-speech";
import { GoogleGenAI } from "@google/genai";
import { type LanguageId, type LessonSegment } from "@resolingo/shared";
import { logger } from "firebase-functions";
import { GEMINI_TTS_LOCATION, GEMINI_TTS_MODEL, TTS_VOICE_TIER } from "./config.js";
import { bucket } from "./firebase.js";
import { vertexProjectId } from "./gemini.js";
import {
  cloudCachePath,
  cloudLanguageCode,
  geminiSpeechRequest,
  renderLessonAudio,
  type LessonSpeaker,
} from "./speech.js";
import { selectVoices, voiceTierFromEnv } from "./voices.js";

const cloudClient = new textToSpeech.TextToSpeechClient();
const voiceCache = new Map<string, string[]>();
let geminiClient: GoogleGenAI | undefined;

function speechClient(): GoogleGenAI {
  geminiClient ??= new GoogleGenAI({
    vertexai: true,
    project: vertexProjectId(),
    location: configured(GEMINI_TTS_LOCATION.value(), "global"),
  });
  return geminiClient;
}

function configured(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

async function voicesFor(language: LanguageId): Promise<string[]> {
  const tier = voiceTierFromEnv(TTS_VOICE_TIER.value());
  const languageCode = cloudLanguageCode(language);
  const cacheKey = `${tier}:${languageCode}`;
  const cached = voiceCache.get(cacheKey);
  if (cached) return cached;
  const [response] = await cloudClient.listVoices({ languageCode });
  const names = (response.voices ?? []).flatMap((voice) => voice.name ? [voice.name] : []);
  const selected = selectVoices(names, tier).voices;
  if (!selected.length) throw new Error(`TTS_VOICE_UNAVAILABLE:${language}`);
  voiceCache.set(cacheKey, selected);
  return selected;
}

function speakingRate(level: string): number {
  if (level === "A1") return 0.78;
  if (level === "A2") return 0.84;
  if (level === "B1") return 0.9;
  return 0.96;
}

type CachedAudio = { durationMs: number };

async function findCached(path: string): Promise<CachedAudio | null> {
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [metadata] = await file.getMetadata();
  const durationMs = Number(metadata.metadata?.durationMs);
  return { durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1_000 };
}

async function saveCached(path: string, bytes: Buffer, contentType: string, durationMs: number): Promise<void> {
  await bucket.file(path).save(bytes, {
    resumable: false,
    contentType,
    metadata: {
      cacheControl: "private,max-age=31536000,immutable",
      metadata: { durationMs: String(durationMs) },
    },
  });
}

async function copyCached(from: string, to: string): Promise<void> {
  await bucket.file(from).copy(bucket.file(to));
}

async function synthesizeWithGemini(input: {
  speaker: LessonSpeaker;
  language: LanguageId;
  text: string;
  delivery: LessonSegment["delivery"];
  level: string;
  cloud: () => Promise<{ cachePath: string; durationMs: number }>;
}): Promise<{ cachePath: string; durationMs: number; extension: "wav" | "mp3" }> {
  const request = geminiSpeechRequest({
    model: configured(GEMINI_TTS_MODEL.value(), "gemini-3.1-flash-tts-preview"),
    speaker: input.speaker,
    language: input.language,
    text: input.text,
    delivery: input.delivery,
    level: input.level,
  });
  const rendered = await renderLessonAudio({
    request,
    load: findCached,
    store: saveCached,
    cloud: input.cloud,
    onGeminiError: (error) => {
      logger.warn("gemini_tts_fallback", {
        language: input.language,
        speaker: input.speaker,
        delivery: input.delivery,
        message: error instanceof Error && error.message.startsWith("TTS_") ? error.message : "GEMINI_TTS_FAILED",
      });
    },
    synthesizeGemini: async () => {
      const response = await speechClient().models.generateContent({
        model: request.model,
        contents: request.contents,
        config: request.config,
      });
      const part = response.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data);
      const data = part?.inlineData?.data;
      if (!data) throw new Error("TTS_EMPTY_AUDIO");
      const mimeType = part?.inlineData?.mimeType;
      return mimeType ? { data, mimeType } : { data };
    },
  });
  return { cachePath: rendered.cachePath, durationMs: rendered.durationMs, extension: rendered.extension };
}

async function synthesizeWithCloudTts(input: {
  speaker: LessonSpeaker;
  language: LanguageId;
  text: string;
  level: string;
}): Promise<{ cachePath: string; durationMs: number }> {
  const voices = await voicesFor(input.language);
  const voiceName = (input.speaker === "speakerB" ? voices[1] : voices[0]) ?? voices[0]!;
  const languageCode = cloudLanguageCode(input.language);
  const rate = speakingRate(input.level);
  const cachePath = cloudCachePath({ voiceName, languageCode, speakingRate: rate, text: input.text });
  const cached = await findCached(cachePath);
  if (cached) return { cachePath, durationMs: cached.durationMs };
  const [response] = await cloudClient.synthesizeSpeech({
    input: { text: input.text },
    voice: { languageCode, name: voiceName },
    audioConfig: {
      audioEncoding: protos.google.cloud.texttospeech.v1.AudioEncoding.MP3,
      speakingRate: rate,
    },
  });
  if (!response.audioContent) throw new Error("TTS_EMPTY_AUDIO");
  const words = input.text.trim().split(/\s+/u).length;
  const durationMs = Math.max(1_000, Math.round((words / (150 * rate)) * 60_000));
  await saveCached(cachePath, Buffer.from(response.audioContent as Uint8Array), "audio/mpeg", durationMs);
  return { cachePath, durationMs };
}

export async function synthesizeSegment(input: {
  uid: string;
  lessonId: string;
  level: string;
  segment: LessonSegment;
}): Promise<LessonSegment> {
  const speaker = input.segment.speaker;
  const delivery = input.segment.delivery ?? "warm";
  const rendered = await synthesizeWithGemini({
    speaker,
    language: input.segment.language,
    text: input.segment.text,
    delivery,
    level: input.level,
    cloud: () => synthesizeWithCloudTts({
      speaker,
      language: input.segment.language,
      text: input.segment.text,
      level: input.level,
    }),
  });
  const audioPath = `users/${input.uid}/lessons/${input.lessonId}/segments/${input.segment.id}.${rendered.extension}`;
  await copyCached(rendered.cachePath, audioPath);
  return { ...input.segment, delivery, audioPath, durationMs: rendered.durationMs };
}
