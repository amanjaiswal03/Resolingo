import textToSpeech, { protos } from "@google-cloud/text-to-speech";
import { GoogleGenAI } from "@google/genai";
import { speechSpans, type LanguageId, type LessonSegment, type SpeakerNames } from "@resolingo/shared";
import { logger } from "firebase-functions";
import { GEMINI_TTS_LOCATION, GEMINI_TTS_MODEL, TTS_VOICE_TIER } from "./config.js";
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
  pcmWithTrailingSilence,
  renderLessonAudio,
  sceneChunks,
  sceneSpeechRequest,
  wrapPcm16AsWav,
  type LessonSpeaker,
  type SceneChunk,
} from "./speech.js";
import { assignRoleVoices, voiceTierFromEnv, voiceTierOf, type ListedVoice, type RoleVoiceAssignment } from "./voices.js";

const cloudClient = new textToSpeech.TextToSpeechClient();
const voiceCache = new Map<string, RoleVoiceAssignment>();
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

function listedGender(value: unknown): ListedVoice["gender"] {
  const text = String(value ?? "").toUpperCase();
  if (text.includes("FEMALE")) return "FEMALE";
  if (text.includes("MALE")) return "MALE";
  return "NEUTRAL";
}

async function voicesFor(language: LanguageId): Promise<RoleVoiceAssignment> {
  const tier = voiceTierFromEnv(TTS_VOICE_TIER.value());
  const languageCode = cloudLanguageCode(language);
  const cacheKey = `${tier}:${languageCode}`;
  const cached = voiceCache.get(cacheKey);
  if (cached) return cached;
  const [response] = await cloudClient.listVoices({ languageCode });
  const listed = (response.voices ?? []).flatMap((voice): ListedVoice[] => {
    if (!voice.name || !voiceTierOf(voice.name)) return [];
    return [{ name: voice.name, gender: listedGender(voice.ssmlGender) }];
  });
  const selected = assignRoleVoices(listed, tier);
  if (!selected.teacher) throw new Error(`TTS_VOICE_UNAVAILABLE:${language}`);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

async function geminiInline(request: { model: string; contents: string; config: ReturnType<typeof geminiSpeechRequest>["config"] }): Promise<{ data: string; mimeType?: string }> {
  let last: unknown;
  for (let attempt = 0; attempt < GEMINI_ATTEMPTS; attempt += 1) {
    try {
      const response = await speechClient().models.generateContent({
        model: request.model,
        contents: request.contents,
        config: request.config,
      });
      const parts = response.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
      const part = parts.find((item) => item.inlineData?.data);
      const data = part?.inlineData?.data;
      if (!data) throw new Error("TTS_EMPTY_AUDIO");
      const mimeType = part?.inlineData?.mimeType;
      return mimeType ? { data, mimeType } : { data };
    } catch (error) {
      last = error;
      const status = httpStatusOf(error);
      if (attempt + 1 < GEMINI_ATTEMPTS && (status === 429 || status === 503)) await delay(700);
    }
  }
  if (last instanceof Error) throw last;
  const failed = new Error("GEMINI_TTS_FAILED");
  if (last && typeof last === "object") Object.assign(failed, last);
  throw failed;
}

async function synthesizeWithGemini(input: {
  segment: LessonSegment;
  speaker: LessonSpeaker;
  language: LanguageId;
  text: string;
  delivery: LessonSegment["delivery"];
  level: string;
  targetLanguage: LanguageId;
  cloud: () => Promise<{ cachePath: string; durationMs: number }>;
}): Promise<{ cachePath: string; durationMs: number; extension: "wav" | "mp3" }> {
  const request = geminiSpeechRequest({
    model: configured(GEMINI_TTS_MODEL.value(), "gemini-3.1-flash-tts-preview"),
    speaker: input.speaker,
    language: input.language,
    text: input.text,
    delivery: input.delivery,
    level: input.level,
    targetLanguage: input.targetLanguage,
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
  return voices[speaker];
}

export async function synthesizeTeacherFeedback(language: LanguageId, text: string, delivery: "praise" | "gentle"): Promise<string> {
  const segment = { id: "voice_feedback", kind: "narration", speaker: "teacher", language, text, delivery } as const;
  const rendered = await synthesizeWithGemini({
    segment,
    speaker: segment.speaker,
    language,
    text,
    delivery,
    level: "C1",
    targetLanguage: language,
    cloud: () => synthesizeWithCloudTts({ speaker: segment.speaker, language, text, level: "C1", targetLanguage: language }),
  });
  const [audio] = await bucket.file(rendered.cachePath).download();
  return audio.toString("base64");
}

async function synthesizeWithCloudTts(input: {
  speaker: LessonSpeaker;
  language: LanguageId;
  text: string;
  level: string;
  targetLanguage: LanguageId;
}): Promise<{ cachePath: string; durationMs: number }> {
  const voiceName = await voiceNameFor(input.speaker, input.language);
  const cloud = cloudSynthesis({ language: input.language, level: input.level, pcm: false, targetLanguage: input.targetLanguage });
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
  targetLanguage: LanguageId;
}): Promise<Buffer> {
  const request = geminiSpeechRequest({
    model: configured(GEMINI_TTS_MODEL.value(), "gemini-3.1-flash-tts-preview"),
    speaker: input.speaker,
    language: input.language,
    text: input.text,
    delivery: input.delivery,
    level: input.level,
    targetLanguage: input.targetLanguage,
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
  targetLanguage: LanguageId;
}): Promise<Buffer> {
  const voiceName = await voiceNameFor(input.speaker, input.language);
  const cloud = cloudSynthesis({ language: input.language, level: input.level, pcm: true, targetLanguage: input.targetLanguage });
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
  targetLanguage: LanguageId;
}): Promise<Buffer> {
  try {
    return await geminiPcm(input);
  } catch (error) {
    fallbackLog({ segment: input.segment, language: input.language, error });
    return cloudPcm(input);
  }
}

export async function synthesizePhrasePreview(input: {
  uid: string;
  phraseId: string;
  text: string;
  language: LanguageId;
  level: string;
}): Promise<string> {
  const segment: LessonSegment = {
    id: "preview",
    kind: "example",
    speaker: "teacher",
    delivery: "clear",
    language: input.language,
    text: input.text,
  };
  const rendered = await synthesizeWithGemini({
    segment,
    speaker: "teacher",
    language: input.language,
    text: input.text,
    delivery: "clear",
    level: input.level,
    targetLanguage: input.language,
    cloud: () => synthesizeWithCloudTts({
      speaker: "teacher",
      language: input.language,
      text: input.text,
      level: input.level,
      targetLanguage: input.language,
    }),
  });
  const audioPath = `users/${input.uid}/phrases/${input.phraseId}/preview.${rendered.extension}`;
  await copyCached(rendered.cachePath, audioPath);
  return audioPath;
}

export async function synthesizeSegment(input: {
  uid: string;
  lessonId: string;
  level: string;
  targetLanguage: LanguageId;
  segment: LessonSegment;
}): Promise<LessonSegment> {
  const speaker = input.segment.speaker;
  const delivery = input.segment.delivery ?? "warm";
  const spans = speechSpans(input.segment.text, input.segment.language).filter((span) => /[\p{L}\p{N}]/u.test(span.text));
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
      targetLanguage: input.targetLanguage,
      cloud: () => synthesizeWithCloudTts({
        speaker,
        language: piece.language,
        text: piece.text,
        level: input.level,
        targetLanguage: input.targetLanguage,
      }),
    });
    const pauseMs = input.segment.pauseAfterMs ?? 0;
    if (pauseMs <= 0) {
      const audioPath = `users/${input.uid}/lessons/${input.lessonId}/segments/${input.segment.id}.${rendered.extension}`;
      await copyCached(rendered.cachePath, audioPath);
      return { ...input.segment, delivery, audioPath, durationMs: rendered.durationMs };
    }
    const cachedPcm = rendered.extension === "wav" ? await loadPcm(rendered.cachePath) : null;
    const voiced = cachedPcm && cachedPcm.length > 0
      ? cachedPcm
      : await cloudPcm({ speaker, language: piece.language, text: piece.text, level: input.level, targetLanguage: input.targetLanguage });
    const pcm = pcmWithTrailingSilence(voiced, pauseMs);
    const durationMs = pcmDurationMs(pcm.length);
    const audioPath = `users/${input.uid}/lessons/${input.lessonId}/segments/${input.segment.id}.wav`;
    await saveCached(audioPath, wrapPcm16AsWav(pcm), "audio/wav", durationMs);
    return { ...input.segment, delivery, audioPath, durationMs };
  }
  const pcm = pcmWithTrailingSilence(concatPcm16(await Promise.all(pieces.map((piece) => spanPcm({
    segment: input.segment,
    speaker,
    language: piece.language,
    text: piece.text.trim(),
    delivery,
    level: input.level,
    targetLanguage: input.targetLanguage,
  }))), 0), input.segment.pauseAfterMs ?? 0);
  const audioPath = `users/${input.uid}/lessons/${input.lessonId}/segments/${input.segment.id}.wav`;
  const durationMs = pcmDurationMs(pcm.length);
  await saveCached(audioPath, wrapPcm16AsWav(pcm), "audio/wav", durationMs);
  return { ...input.segment, delivery, audioPath, durationMs };
}

const SCENE_GAP_MS = 160;

async function cloudScene(input: {
  turns: SceneChunk[];
  level: string;
  targetLanguage: LanguageId;
}): Promise<{ cachePath: string; durationMs: number }> {
  const language = input.turns[0]!.language;
  const voices = await voicesFor(language);
  const pieces: Buffer[] = [];
  for (const turn of input.turns) {
    pieces.push(await cloudPcm({ speaker: turn.speaker, language: turn.language, text: turn.text, level: input.level, targetLanguage: input.targetLanguage }));
  }
  const pcm = concatPcm16(pieces, SCENE_GAP_MS);
  const cloud = cloudSynthesis({ language, level: input.level, pcm: true });
  const cachePath = cloudCachePath({
    voiceName: `scene:${voices.teacher}/${voices.speakerA}/${voices.speakerB}`,
    languageCode: cloud.languageCode,
    speakingRate: cloud.speakingRate,
    text: input.turns.map((turn) => `${turn.speaker}:${turn.text}`).join("\n"),
    encoding: "LINEAR16",
  });
  const durationMs = pcmDurationMs(pcm.length);
  await saveCached(cachePath, wrapPcm16AsWav(pcm), "audio/wav", durationMs);
  return { cachePath, durationMs };
}

async function renderChunk(input: {
  segment: LessonSegment;
  turns: SceneChunk[];
  names: SpeakerNames;
  level: string;
  targetLanguage: LanguageId;
}): Promise<{ cachePath: string; durationMs: number; extension: "wav" | "mp3" }> {
  const request = sceneSpeechRequest({
    model: configured(GEMINI_TTS_MODEL.value(), "gemini-3.1-flash-tts-preview"),
    turns: input.turns,
    names: input.names,
    level: input.level,
    language: input.turns[0]!.language,
    targetLanguage: input.targetLanguage,
  });
  return renderLessonAudio({
    request,
    load: findCached,
    store: saveCached,
    onGeminiError: (error) => fallbackLog({ segment: input.segment, language: input.turns[0]!.language, error }),
    synthesizeGemini: () => geminiInline(request),
    cloud: () => cloudScene({ turns: input.turns, level: input.level, targetLanguage: input.targetLanguage }),
  });
}

export async function synthesizeScene(input: {
  uid: string;
  lessonId: string;
  level: string;
  targetLanguage: LanguageId;
  segments: LessonSegment[];
  names: SpeakerNames;
}): Promise<LessonSegment[]> {
  const chunks = sceneChunks(input.segments, input.names);
  const first = input.segments[0]!;
  let audioPath: string;
  let durationMs: number;
  if (chunks.length === 1) {
    const rendered = await renderChunk({ segment: first, turns: chunks[0]!, names: input.names, level: input.level, targetLanguage: input.targetLanguage });
    audioPath = `users/${input.uid}/lessons/${input.lessonId}/segments/${first.id}.${rendered.extension}`;
    durationMs = rendered.durationMs;
    await copyCached(rendered.cachePath, audioPath);
  } else {
    const pieces: Buffer[] = [];
    for (const chunk of chunks) {
      const rendered = await renderChunk({ segment: first, turns: chunk, names: input.names, level: input.level, targetLanguage: input.targetLanguage });
      const pcm = await loadPcm(rendered.cachePath);
      if (!pcm || pcm.length === 0) throw new Error("TTS_EMPTY_AUDIO");
      pieces.push(pcm);
    }
    const pcm = concatPcm16(pieces, SCENE_GAP_MS);
    audioPath = `users/${input.uid}/lessons/${input.lessonId}/segments/${first.id}.wav`;
    durationMs = pcmDurationMs(pcm.length);
    await saveCached(audioPath, wrapPcm16AsWav(pcm), "audio/wav", durationMs);
  }
  return input.segments.map((segment, index) => ({
    ...segment,
    delivery: segment.delivery ?? "warm",
    audioPath,
    ...(index === 0 ? { durationMs } : {}),
  }));
}
