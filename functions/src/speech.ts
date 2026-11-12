import { createHash } from "node:crypto";
import { Modality, type GenerateContentConfig } from "@google/genai";
import {
  languageById,
  type Delivery,
  type LanguageId,
} from "@resolingo/shared";
import { DEFAULT_GEMINI_TTS_MODEL } from "./config.js";

export const GEMINI_TTS_SAMPLE_RATE = 24_000;

/** Prebuilt Gemini 3.1 Flash TTS voices. Kore tutors; Puck and Leda are the two dialogue roles. */
export const roleVoices = {
  teacher: "Kore",
  speakerA: "Puck",
  speakerB: "Leda",
} as const;

export type LessonSpeaker = keyof typeof roleVoices;

const deliveryDirection: Record<Delivery, string> = {
  warm: "You are a warm tutor. Sound encouraging and kind.",
  praise: "Give bright, excited praise, as if the learner just did something well.",
  gentle: "Offer a gentle correction. Stay soft and patient, never sharp.",
  curious: "Ask this as a curious question, with genuine rising interest.",
  clear: "Say this more slowly and clearly for a new word. Leave a short natural pause between phrases.",
  playful: "Sound playful and friendly, with light amusement.",
};

const performanceTag: Record<Delivery, string> = {
  warm: "",
  praise: "[excited] ",
  gentle: "[gently] ",
  curious: "[curious] ",
  clear: "[slowly] ",
  playful: "[amused] ",
};

export function paceForLevel(level: string): "slow" | "moderate" | "natural" {
  if (level === "A1" || level === "A2") return "slow";
  if (level === "B1") return "moderate";
  return "natural";
}

const paceDirection = {
  slow: "Speak a little more slowly than conversation, with clear vowels.",
  moderate: "Speak at a relaxed conversational pace.",
  natural: "Speak at a natural conversational pace.",
} as const;

export function cloudLanguageCode(language: LanguageId): string {
  return languageById[language].googleTtsLanguageCode;
}

/** Vertex examples use regional tags such as en-in. Arabic stays on ar-XA, matching Cloud TTS. */
export function geminiLanguageCode(language: LanguageId): string {
  return cloudLanguageCode(language).toLowerCase();
}

export function speechContents(input: {
  speaker: LessonSpeaker;
  text: string;
  delivery: Delivery;
  level: string;
  language: LanguageId;
}): string {
  const pace = paceForLevel(input.level);
  const languageName = languageById[input.language].label;
  const direction = `${deliveryDirection[input.delivery]} ${paceDirection[pace]} Pronounce this as a native speaker of ${languageName}. Do not imitate a foreign accent. Perform the expression. Do not read bracketed stage directions aloud.`;
  const spoken = `${performanceTag[input.delivery]}${input.text}`;
  if (input.speaker === "teacher") return `${direction}: ${spoken}`;
  const alias = input.speaker === "speakerA" ? "SpeakerA" : "SpeakerB";
  return `${direction} Only ${alias} speaks.\n${alias}: ${spoken}`;
}

export function geminiSpeechConfig(input: {
  speaker: LessonSpeaker;
  language: LanguageId;
}): GenerateContentConfig {
  const languageCode = geminiLanguageCode(input.language);
  if (input.speaker === "teacher") {
    return {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        languageCode,
        voiceConfig: { prebuiltVoiceConfig: { voiceName: roleVoices.teacher } },
      },
    };
  }
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      languageCode,
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          {
            speaker: "SpeakerA",
            voiceConfig: { prebuiltVoiceConfig: { voiceName: roleVoices.speakerA } },
          },
          {
            speaker: "SpeakerB",
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
}): { languageCode: string; audioEncoding: "MP3" | "LINEAR16"; sampleRateHertz?: number; speakingRate: number } {
  const languageCode = cloudLanguageCode(input.language);
  const speakingRate = speakingRateForLevel(input.level);
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
export function geminiFallbackFields(input: {
  segmentId: string;
  kind: string;
  speaker: string;
  language: string;
  delivery: string;
  error: unknown;
}): { segmentId: string; segmentKind: string; speaker: string; language: string; delivery: string; message: string } {
  const raw = input.error instanceof Error ? input.error.message : String(input.error);
  return {
    segmentId: input.segmentId,
    segmentKind: input.kind,
    speaker: input.speaker,
    language: input.language,
    delivery: input.delivery,
    message: raw.replace(/\s+/g, " ").slice(0, 400),
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
    return { cachePath: fallback.cachePath, durationMs: fallback.durationMs, extension: "mp3", engine: "cloud-tts" };
  }
}

export function geminiSpeechRequest(input: {
  model?: string;
  speaker: LessonSpeaker;
  language: LanguageId;
  text: string;
  delivery: Delivery;
  level: string;
}): { model: string; contents: string; config: GenerateContentConfig; cachePath: string } {
  const model = input.model?.trim() || DEFAULT_GEMINI_TTS_MODEL;
  const contents = speechContents(input);
  return {
    model,
    contents,
    config: geminiSpeechConfig(input),
    cachePath: geminiCachePath({ model, contents, speaker: input.speaker, language: input.language }),
  };
}
