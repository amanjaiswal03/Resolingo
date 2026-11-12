import textToSpeech, { protos } from "@google-cloud/text-to-speech";
import { GoogleGenAI } from "@google/genai";
import { speechSpans, type LanguageId, type LessonSegment } from "@resolingo/shared";
import { logger } from "firebase-functions";
import { mapConcurrent } from "./concurrent.js";
import { GEMINI_TTS_LOCATION, GEMINI_TTS_MODEL, TTS_SPAN_CONCURRENCY, TTS_VOICE_TIER } from "./config.js";
import { bucket } from "./firebase.js";
import { vertexProjectId } from "./gemini.js";
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
  wrapPcm16AsWav,
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

type CachedAudio = { durationMs: number };

const GEMINI_ATTEMPTS = 2;

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

function fallbackLog(input: {
  segment: LessonSegment;
  language: LanguageId;
  error: unknown;
}): void {
  // The opening tutor line is the one that mixes languages. A Gemini error used
  // to be replaced by Cloud TTS with the message hidden, so that clip kept the
  // old WaveNet voice while every single-language line stayed on Gemini.
  logger.warn("gemini_tts_fallback", geminiFallbackFields({
    segmentId: input.segment.id,
    kind: input.segment.kind,
    speaker: input.segment.speaker,
    language: input.language,
    delivery: input.segment.delivery ?? "warm",
    error: input.error,
  }));
}

async function geminiInline(request: ReturnType<typeof geminiSpeechRequest>): Promise<{ data: string; mimeType?: string }> {
  let last: unknown;
  for (let attempt = 0; attempt < GEMINI_ATTEMPTS; attempt += 1) {
    try {
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
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("GEMINI_TTS_FAILED");
}

async function synthesizeWithGemini(input: {
  segment: LessonSegment;
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
    onGeminiError: (error) => fallbackLog({ segment: input.segment, language: input.language, error }),
    synthesizeGemini: () => geminiInline(request),
  });
  return { cachePath: rendered.cachePath, durationMs: rendered.durationMs, extension: rendered.extension };
}

async function voiceNameFor(speaker: LessonSpeaker, language: LanguageId): Promise<string> {
  const voices = await voicesFor(language);
  return (speaker === "speakerB" ? voices[1] : voices[0]) ?? voices[0]!;
}

async function synthesizeWithCloudTts(input: {
  speaker: LessonSpeaker;
  language: LanguageId;
  text: string;
  level: string;
}): Promise<{ cachePath: string; durationMs: number }> {
  const voiceName = await voiceNameFor(input.speaker, input.language);
  const cloud = cloudSynthesis({ language: input.language, level: input.level, pcm: false });
  const cachePath = cloudCachePath({
    voiceName,
    languageCode: cloud.languageCode,
    speakingRate: cloud.speakingRate,
    text: input.text,
    encoding: "MP3",
  });
  const cached = await findCached(cachePath);
  if (cached) return { cachePath, durationMs: cached.durationMs };
  const [response] = await cloudClient.synthesizeSpeech({
    input: { text: input.text },
    voice: { languageCode: cloud.languageCode, name: voiceName },
    audioConfig: {
      audioEncoding: protos.google.cloud.texttospeech.v1.AudioEncoding.MP3,
      speakingRate: cloud.speakingRate,
    },
  });
  if (!response.audioContent) throw new Error("TTS_EMPTY_AUDIO");
  const words = input.text.trim().split(/\s+/u).length;
  const durationMs = Math.max(1_000, Math.round((words / (150 * cloud.speakingRate)) * 60_000));
  await saveCached(cachePath, Buffer.from(response.audioContent as Uint8Array), "audio/mpeg", durationMs);
  return { cachePath, durationMs };
}

async function loadPcm(path: string): Promise<Buffer | null> {
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [bytes] = await file.download();
  return pcmPayload(Buffer.from(bytes));
}

async function geminiPcm(input: {
  segment: LessonSegment;
  speaker: LessonSpeaker;
  language: LanguageId;
  text: string;
  delivery: LessonSegment["delivery"];
  level: string;
}): Promise<Buffer> {
  const request = geminiSpeechRequest({
    model: configured(GEMINI_TTS_MODEL.value(), "gemini-3.1-flash-tts-preview"),
    speaker: input.speaker,
    language: input.language,
    text: input.text,
    delivery: input.delivery,
    level: input.level,
  });
  const cached = await loadPcm(request.cachePath);
  if (cached && cached.length > 0) return cached;
  const inline = await geminiInline(request);
  const raw = Buffer.from(inline.data, "base64");
  if (raw.length === 0) throw new Error("TTS_EMPTY_AUDIO");
  const pcm = pcmPayload(raw);
  const wav = wrapPcm16AsWav(pcm);
  await saveCached(request.cachePath, wav, "audio/wav", pcmDurationMs(pcm.length));
  return pcm;
}

async function cloudPcm(input: {
  speaker: LessonSpeaker;
  language: LanguageId;
  text: string;
  level: string;
}): Promise<Buffer> {
  const voiceName = await voiceNameFor(input.speaker, input.language);
  const cloud = cloudSynthesis({ language: input.language, level: input.level, pcm: true });
  const cachePath = cloudCachePath({
    voiceName,
    languageCode: cloud.languageCode,
    speakingRate: cloud.speakingRate,
    text: input.text,
    encoding: "LINEAR16",
  });
  const cached = await loadPcm(cachePath);
  if (cached && cached.length > 0) return cached;
  const [response] = await cloudClient.synthesizeSpeech({
    input: { text: input.text },
    voice: { languageCode: cloud.languageCode, name: voiceName },
    audioConfig: {
      audioEncoding: protos.google.cloud.texttospeech.v1.AudioEncoding.LINEAR16,
      sampleRateHertz: cloud.sampleRateHertz ?? 24_000,
      speakingRate: cloud.speakingRate,
    },
  });
  if (!response.audioContent) throw new Error("TTS_EMPTY_AUDIO");
  const pcm = pcmPayload(Buffer.from(response.audioContent as Uint8Array));
  await saveCached(cachePath, wrapPcm16AsWav(pcm), "audio/wav", pcmDurationMs(pcm.length));
  return pcm;
}

async function spanPcm(input: {
  segment: LessonSegment;
  speaker: LessonSpeaker;
  language: LanguageId;
  text: string;
  delivery: LessonSegment["delivery"];
  level: string;
}): Promise<Buffer> {
  try {
    return await geminiPcm(input);
  } catch (error) {
    fallbackLog({ segment: input.segment, language: input.language, error });
    return cloudPcm(input);
  }
}

export async function synthesizeSegment(input: {
  uid: string;
  lessonId: string;
  level: string;
  segment: LessonSegment;
}): Promise<LessonSegment> {
  const speaker = input.segment.speaker;
  const delivery = input.segment.delivery ?? "warm";
  const spans = speechSpans(input.segment.text, input.segment.language);
  const pieces = spans.length > 0 ? spans : [{ language: input.segment.language, text: input.segment.text }];
  if (pieces.length === 1) {
    const piece = pieces[0]!;
    const rendered = await synthesizeWithGemini({
      segment: input.segment,
      speaker,
      language: piece.language,
      text: piece.text,
      delivery,
      level: input.level,
      cloud: () => synthesizeWithCloudTts({
        speaker,
        language: piece.language,
        text: piece.text,
        level: input.level,
      }),
    });
    const audioPath = `users/${input.uid}/lessons/${input.lessonId}/segments/${input.segment.id}.${rendered.extension}`;
    await copyCached(rendered.cachePath, audioPath);
    return { ...input.segment, delivery, audioPath, durationMs: rendered.durationMs };
  }
  const pcmParts = await mapConcurrent(pieces, TTS_SPAN_CONCURRENCY, (piece) => spanPcm({
    segment: input.segment,
    speaker,
    language: piece.language,
    text: piece.text.trim(),
    delivery,
    level: input.level,
  }));
  const pcm = concatPcm16(pcmParts);
  const audioPath = `users/${input.uid}/lessons/${input.lessonId}/segments/${input.segment.id}.wav`;
  const durationMs = pcmDurationMs(pcm.length);
  await saveCached(audioPath, wrapPcm16AsWav(pcm), "audio/wav", durationMs);
  return { ...input.segment, delivery, audioPath, durationMs };
}
