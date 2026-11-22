import { createHash } from "node:crypto";
import { Modality, type GenerateContentConfig } from "@google/genai";
import {
  languageById,
  speechSpans,
  type Delivery,
  type LanguageId,
  type LessonSegment,
  type SpeakerNames,
  DEFAULT_SPEAKER_NAMES,
} from "@resolingo/shared";
import { DEFAULT_GEMINI_TTS_MODEL } from "./config.js";

export const GEMINI_TTS_SAMPLE_RATE = 24_000;

/**
 * Fixed Gemini 3.1 Flash TTS voices. The role id picks the voice; the character
 * name is only the label Gemini matches in the transcript.
 * Achernar is the soft female narrator. Kore is firm, which is the voice that
 * sounded robotic on the teacher lines. Puck is the male dialogue voice.
 * Sulafat is a warm female voice, distinct from Achernar, so the second
 * character does not sound like the teacher.
 */
export const roleVoices = {
  teacher: "Achernar",
  speakerA: "Puck",
  speakerB: "Sulafat",
} as const;

export type LessonSpeaker = keyof typeof roleVoices;

const deliveryStyle: Record<Delivery, string> = {
  warm: "soft, calm, and soothing",
  praise: "soft, calm, and warm",
  gentle: "soft, patient, and gentle",
  curious: "soft, calm, and curious",
  clear: "soft and clear",
  playful: "soft, warm, and lightly playful",
};

const performanceTag: Record<Delivery, string> = {
  warm: "",
  praise: "",
  gentle: "[gently] ",
  curious: "[curious] ",
  clear: "",
  playful: "[amused] ",
};

export function paceForLevel(level: string): "slow" | "moderate" | "natural" {
  if (level === "A1" || level === "A2") return "slow";
  if (level === "B1") return "moderate";
  return "natural";
}

/** Beginner slowing applies only to the language being learned. */
export function paceForSpeech(level: string, language: LanguageId, targetLanguage?: LanguageId): "slow" | "moderate" | "natural" {
  if (targetLanguage && language !== targetLanguage) return "natural";
  return paceForLevel(level);
}

export function speakingRateForSpeech(level: string, language: LanguageId, targetLanguage?: LanguageId): number {
  if (targetLanguage && language !== targetLanguage) return 1;
  return speakingRateForLevel(level);
}

const pacePhrase = {
  slow: "a little more slowly than conversation, with clear vowels",
  moderate: "at a relaxed conversational pace",
  natural: "at a natural conversational pace",
} as const;

export function cloudLanguageCode(language: LanguageId): string {
  return languageById[language].googleTtsLanguageCode;
}

/** Vertex examples use regional tags such as en-in. Arabic stays on ar-XA, matching Cloud TTS. */
export function geminiLanguageCode(language: LanguageId): string {
  return cloudLanguageCode(language).toLowerCase();
}

function spokenLine(text: string, name: string): string {
  return text.trim().replace(new RegExp(`^${name}\\s*:\\s*`, "i"), "").trim();
}

/**
 * Vertex single-speaker TTS speaks the text after one colon. A long roleplay
 * paragraph before that colon comes back with no audio part, which is what
 * sent the teacher welcome, explanation, and recap to Cloud TTS.
 */
export function teacherSpeechContents(input: {
  text: string;
  delivery: Delivery;
  level: string;
  language: LanguageId;
  targetLanguage?: LanguageId;
}): string {
  const languageName = languageById[input.language].label;
  const spoken = `${performanceTag[input.delivery]}${input.text.trim()}`;
  const pace = pacePhrase[paceForSpeech(input.level, input.language, input.targetLanguage)];
  return `Say the following in a ${deliveryStyle[input.delivery]} voice, ${pace}, at a moderate, steady speaking volume, as a native speaker of ${languageName}: ${spoken}`;
}

export type SceneTurn = {
  speaker: "speakerA" | "speakerB";
  text: string;
  delivery: Delivery;
};

export function sceneSpeechContents(input: {
  turns: SceneTurn[];
  names: SpeakerNames;
  level: string;
  language: LanguageId;
  targetLanguage?: LanguageId;
}): string {
  const languageName = languageById[input.language].label;
  const only = new Set(input.turns.map((turn) => turn.speaker));
  const who = only.size === 1 ? `, where only ${input.names[input.turns[0]!.speaker]} speaks` : "";
  const lines = input.turns.map((turn) => {
    const name = input.names[turn.speaker];
    return `${name}: ${performanceTag[turn.delivery]}${spokenLine(turn.text, name)}`;
  }).join("\n");
  const pace = pacePhrase[paceForSpeech(input.level, input.language, input.targetLanguage)];
  return `TTS the following conversation between ${input.names.speakerA} and ${input.names.speakerB}${who} in a natural voice, ${pace}, at a moderate, steady speaking volume, as native speakers of ${languageName}:\n${lines}`;
}

export function teacherSpeechConfig(language: LanguageId): GenerateContentConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      languageCode: geminiLanguageCode(language),
      voiceConfig: { prebuiltVoiceConfig: { voiceName: roleVoices.teacher } },
    },
  };
}

export function sceneSpeechConfig(input: {
  language: LanguageId;
  names: SpeakerNames;
}): GenerateContentConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      languageCode: geminiLanguageCode(input.language),
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          {
            speaker: input.names.speakerA,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: roleVoices.speakerA } },
          },
          {
            speaker: input.names.speakerB,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: roleVoices.speakerB } },
          },
        ],
      },
    },
  };
}

export function cacheObjectPath(material: string, extension: "wav" | "mp3"): string {
  const hash = createHash("sha256").update(material).digest("hex");
  return `tts-cache/${hash}.${extension}`;
}

export function geminiCachePath(input: {
  model: string;
  contents: string;
  speaker: LessonSpeaker;
  language: LanguageId;
}): string {
  const voice = input.speaker === "teacher"
    ? roleVoices.teacher
    : `${roleVoices.speakerA}+${roleVoices.speakerB}`;
  return cacheObjectPath(
    ["gemini", input.model, voice, geminiLanguageCode(input.language), input.contents].join("\n"),
    "wav",
  );
}

export function sceneCachePath(input: {
  model: string;
  contents: string;
  names: SpeakerNames;
  language: LanguageId;
}): string {
  const voice = `${input.names.speakerA}=${roleVoices.speakerA}+${input.names.speakerB}=${roleVoices.speakerB}`;
  return cacheObjectPath(
    ["gemini-scene", input.model, voice, geminiLanguageCode(input.language), input.contents].join("\n"),
    "wav",
  );
}

export function speakingRateForLevel(level: string): number {
  if (level === "A1") return 0.78;
  if (level === "A2") return 0.84;
  if (level === "B1") return 0.9;
  return 0.96;
}

export function cloudSynthesis(input: {
  language: LanguageId;
  level: string;
  pcm: boolean;
  targetLanguage?: LanguageId;
}): { languageCode: string; audioEncoding: "MP3" | "LINEAR16"; sampleRateHertz?: number; speakingRate: number } {
  const languageCode = cloudLanguageCode(input.language);
  const speakingRate = speakingRateForSpeech(input.level, input.language, input.targetLanguage);
  if (input.pcm) {
    return { languageCode, audioEncoding: "LINEAR16", sampleRateHertz: GEMINI_TTS_SAMPLE_RATE, speakingRate };
  }
  return { languageCode, audioEncoding: "MP3", speakingRate };
}

export function cloudCachePath(input: {
  voiceName: string;
  languageCode: string;
  speakingRate: number;
  text: string;
  encoding?: "MP3" | "LINEAR16";
}): string {
  const encoding = input.encoding ?? "MP3";
  return cacheObjectPath(
    ["cloud-tts", input.voiceName, input.languageCode, String(input.speakingRate), encoding, input.text].join("\n"),
    encoding === "LINEAR16" ? "wav" : "mp3",
  );
}

export function concatPcm16(chunks: Buffer[], gapMs = 80, sampleRate = GEMINI_TTS_SAMPLE_RATE): Buffer {
  const gap = Buffer.alloc(Math.round(sampleRate * 2 * gapMs / 1000));
  const parts: Buffer[] = [];
  chunks.forEach((chunk, index) => {
    if (index > 0 && gap.length > 0) parts.push(gap);
    if (chunk.length > 0) parts.push(chunk);
  });
  return Buffer.concat(parts);
}

export function pcmPayload(bytes: Buffer): Buffer {
  if (bytes.length >= 44 && bytes.subarray(0, 4).toString("ascii") === "RIFF") return bytes.subarray(44);
  return bytes;
}

/** Structured fallback record. The spoken line itself is not included. */
function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Fallback diagnostics. The spoken line is not included. The error text is
 * `errorMessage` rather than `message`, because Cloud Logging uses `message`
 * as the log entry text and drops it from the payload.
 */
export function geminiFallbackFields(input: {
  segmentId: string;
  kind: string;
  speaker: string;
  language: string;
  delivery: string;
  error: unknown;
}): { segmentId: string; segmentKind: string; speaker: string; language: string; delivery: string; errorMessage: string; errorCode: string; httpStatus: string } {
  const record = input.error && typeof input.error === "object" ? input.error as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const raw = input.error instanceof Error
    ? input.error.message
    : stringField(record.message) ?? stringField(nested.message) ?? "GEMINI_TTS_FAILED";
  const status = numberField(record.status) ?? numberField(nested.code) ?? numberField(nested.status);
  const code = stringField(record.code) ?? stringField(nested.status) ?? stringField(nested.code) ?? (status ? String(status) : "unknown");
  return {
    segmentId: input.segmentId,
    segmentKind: input.kind,
    speaker: input.speaker,
    language: input.language,
    delivery: input.delivery,
    errorMessage: raw.replace(/\s+/g, " ").slice(0, 240),
    errorCode: code.slice(0, 80),
    httpStatus: status ? String(status) : "unknown",
  };
}

export function wrapPcm16AsWav(pcm: Buffer, sampleRate = GEMINI_TTS_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function pcmDurationMs(pcmByteLength: number, sampleRate = GEMINI_TTS_SAMPLE_RATE): number {
  const samples = Math.floor(pcmByteLength / 2);
  return Math.max(1, Math.round((samples / sampleRate) * 1000));
}

/** Trailing silence so autoplay waits for the learner. Applied on the lesson file, not the shared TTS cache. */
export function pcmWithTrailingSilence(pcm: Buffer, pauseMs: number, sampleRate = GEMINI_TTS_SAMPLE_RATE): Buffer {
  if (pauseMs <= 0) return pcm;
  const silence = Buffer.alloc(Math.round(sampleRate * 2 * pauseMs / 1000));
  return Buffer.concat([pcm, silence]);
}

export function toPlayableAudio(inline: { data: string; mimeType?: string }): {
  bytes: Buffer;
  contentType: string;
  extension: "wav" | "mp3";
  durationMs: number;
} {
  const raw = Buffer.from(inline.data, "base64");
  if (raw.length === 0) throw new Error("TTS_EMPTY_AUDIO");
  const mime = (inline.mimeType ?? "").toLowerCase();
  if (mime.includes("mpeg") || mime.includes("mp3")) {
    return { bytes: raw, contentType: "audio/mpeg", extension: "mp3", durationMs: 1_000 };
  }
  if (raw.subarray(0, 4).toString("ascii") === "RIFF") {
    return { bytes: raw, contentType: "audio/wav", extension: "wav", durationMs: pcmDurationMs(Math.max(0, raw.length - 44)) };
  }
  return {
    bytes: wrapPcm16AsWav(raw),
    contentType: "audio/wav",
    extension: "wav",
    durationMs: pcmDurationMs(raw.length),
  };
}

export async function renderLessonAudio(input: {
  request: { cachePath: string };
  load: (path: string) => Promise<{ durationMs: number } | null>;
  store: (path: string, bytes: Buffer, contentType: string, durationMs: number) => Promise<void>;
  synthesizeGemini: () => Promise<{ data: string; mimeType?: string }>;
  cloud: () => Promise<{ cachePath: string; durationMs: number }>;
  onGeminiError?: (error: unknown) => void;
}): Promise<{ cachePath: string; durationMs: number; extension: "wav" | "mp3"; engine: "gemini" | "cloud-tts" }> {
  const cached = await input.load(input.request.cachePath);
  if (cached) return { cachePath: input.request.cachePath, durationMs: cached.durationMs, extension: "wav", engine: "gemini" };
  try {
    const inline = await input.synthesizeGemini();
    const audio = inline.mimeType
      ? toPlayableAudio({ data: inline.data, mimeType: inline.mimeType })
      : toPlayableAudio({ data: inline.data });
    const cachePath = audio.extension === "wav" ? input.request.cachePath : input.request.cachePath.replace(/\.wav$/, ".mp3");
    await input.store(cachePath, audio.bytes, audio.contentType, audio.durationMs);
    return { cachePath, durationMs: audio.durationMs, extension: audio.extension, engine: "gemini" };
  } catch (error) {
    input.onGeminiError?.(error);
    const fallback = await input.cloud();
    const extension = fallback.cachePath.endsWith(".wav") ? "wav" : "mp3";
    return { cachePath: fallback.cachePath, durationMs: fallback.durationMs, extension, engine: "cloud-tts" };
  }
}

export function geminiSpeechRequest(input: {
  model?: string;
  speaker: LessonSpeaker;
  language: LanguageId;
  text: string;
  delivery: Delivery;
  level: string;
  names?: SpeakerNames;
  targetLanguage?: LanguageId;
}): { model: string; contents: string; config: GenerateContentConfig; cachePath: string } {
  const model = input.model?.trim() || DEFAULT_GEMINI_TTS_MODEL;
  if (input.speaker === "teacher") {
    const contents = teacherSpeechContents(input);
    return {
      model,
      contents,
      config: teacherSpeechConfig(input.language),
      cachePath: geminiCachePath({ model, contents, speaker: "teacher", language: input.language }),
    };
  }
  return sceneSpeechRequest({
    model,
    turns: [{ speaker: input.speaker, text: input.text, delivery: input.delivery }],
    names: input.names ?? DEFAULT_SPEAKER_NAMES,
    level: input.level,
    language: input.language,
    ...(input.targetLanguage ? { targetLanguage: input.targetLanguage } : {}),
  });
}

export function sceneSpeechRequest(input: {
  model?: string;
  turns: SceneTurn[];
  names: SpeakerNames;
  level: string;
  language: LanguageId;
  targetLanguage?: LanguageId;
}): { model: string; contents: string; config: GenerateContentConfig; cachePath: string } {
  const model = input.model?.trim() || DEFAULT_GEMINI_TTS_MODEL;
  const contents = sceneSpeechContents(input);
  return {
    model,
    contents,
    config: sceneSpeechConfig(input),
    cachePath: sceneCachePath({ model, contents, names: input.names, language: input.language }),
  };
}

export type LessonAudioUnit =
  | { kind: "teacher"; segment: LessonSegment }
  | { kind: "scene"; segments: LessonSegment[] };

/**
 * Teacher lines stay single-speaker. Consecutive dialogue lines are one conversation.
 * A line with pauseAfterMs stays its own clip so the silence belongs to that line.
 */
export function lessonAudioUnits(segments: LessonSegment[]): LessonAudioUnit[] {
  const units: LessonAudioUnit[] = [];
  let scene: LessonSegment[] = [];
  const flush = () => {
    if (!scene.length) return;
    units.push({ kind: "scene", segments: scene });
    scene = [];
  };
  for (const segment of segments) {
    if (segment.speaker === "teacher" || (segment.pauseAfterMs ?? 0) > 0) {
      flush();
      units.push({ kind: "teacher", segment });
    } else {
      scene.push(segment);
    }
  }
  flush();
  return units;
}

export type SceneChunk = SceneTurn & { language: LanguageId };

function hasSpeech(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** Split a scene where the language changes, so each multi-speaker call has one language. */
export function sceneChunks(segments: LessonSegment[], names: SpeakerNames): SceneChunk[][] {
  const turns: SceneChunk[] = [];
  for (const segment of segments) {
    if (segment.speaker === "teacher") continue;
    const speaker = segment.speaker === "speakerB" ? "speakerB" : "speakerA";
    const spans = speechSpans(segment.text, segment.language);
    const pieces = spans.length > 0 ? spans : [{ language: segment.language, text: segment.text }];
    for (const span of pieces) {
      const text = spokenLine(span.text, names[speaker]);
      if (!hasSpeech(text)) continue;
      turns.push({ speaker, text, delivery: segment.delivery ?? "warm", language: span.language });
    }
  }
  if (turns.length === 0) {
    return segments.flatMap((segment) => {
      if (segment.speaker === "teacher") return [];
      const speaker = segment.speaker === "speakerB" ? "speakerB" : "speakerA";
      return [[{ speaker, text: segment.text.trim(), delivery: segment.delivery ?? "warm", language: segment.language }]];
    });
  }
  const chunks: SceneChunk[][] = [];
  for (const turn of turns) {
    const last = chunks[chunks.length - 1];
    if (last && last[0]?.language === turn.language) last.push(turn);
    else chunks.push([turn]);
  }
  return chunks;
}
