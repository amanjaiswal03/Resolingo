import textToSpeech, { protos } from "@google-cloud/text-to-speech";
import { type LanguageId, type LessonSegment, languageById } from "@resolingo/shared";
import { TTS_VOICE_TIER } from "./config.js";
import { bucket } from "./firebase.js";
import { selectVoices, voiceTierFromEnv } from "./voices.js";

const client = new textToSpeech.TextToSpeechClient();
const voiceCache = new Map<string, string[]>();

async function voicesFor(language: LanguageId): Promise<string[]> {
  const tier = voiceTierFromEnv(TTS_VOICE_TIER.value());
  const cacheKey = `${tier}:${language}`;
  const cached = voiceCache.get(cacheKey);
  if (cached) return cached;
  const config = languageById[language];
  const [response] = await client.listVoices({ languageCode: config.googleTtsLanguageCode });
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

export async function synthesizeSegment(input: {
  uid: string;
  lessonId: string;
  level: string;
  segment: LessonSegment;
}): Promise<LessonSegment> {
  const voices = await voicesFor(input.segment.language);
  const voiceIndex = input.segment.speaker === "speakerB" ? 1 : 0;
  const voiceName = voices[voiceIndex] ?? voices[0]!;
  const [response] = await client.synthesizeSpeech({
    input: { text: input.segment.text },
    voice: {
      languageCode: languageById[input.segment.language].googleTtsLanguageCode,
      name: voiceName,
    },
    audioConfig: {
      audioEncoding: protos.google.cloud.texttospeech.v1.AudioEncoding.MP3,
      speakingRate: speakingRate(input.level),
    },
  });
  if (!response.audioContent) throw new Error("TTS_EMPTY_AUDIO");
  const audioPath = `users/${input.uid}/lessons/${input.lessonId}/segments/${input.segment.id}.mp3`;
  await bucket.file(audioPath).save(Buffer.from(response.audioContent as Uint8Array), {
    resumable: false,
    contentType: "audio/mpeg",
    metadata: { cacheControl: "private,max-age=31536000,immutable" },
  });
  const words = input.segment.text.trim().split(/\s+/u).length;
  const durationMs = Math.max(1_000, Math.round((words / (150 * speakingRate(input.level))) * 60_000));
  return { ...input.segment, audioPath, durationMs };
}
