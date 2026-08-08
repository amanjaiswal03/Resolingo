import textToSpeech, { protos } from "@google-cloud/text-to-speech";
import { type LanguageId, type LessonSegment, languageById } from "@resolingo/shared";
import { bucket } from "./firebase.js";

const client = new textToSpeech.TextToSpeechClient();
const voiceCache = new Map<string, string[]>();

async function voicesFor(language: LanguageId): Promise<string[]> {
  const cached = voiceCache.get(language);
  if (cached) return cached;
  const config = languageById[language];
  const [response] = await client.listVoices({ languageCode: config.googleTtsLanguageCode });
  const voices = (response.voices ?? [])
    .map((voice) => voice.name)
    .filter((name): name is string => Boolean(name))
    .sort((left, right) => scoreVoice(right) - scoreVoice(left));
  if (!voices.length) throw new Error(`TTS_VOICE_UNAVAILABLE:${language}`);
  voiceCache.set(language, voices);
  return voices;
}

function scoreVoice(name: string): number {
  if (name.includes("Chirp3")) return 4;
  if (name.includes("Neural2")) return 3;
  if (name.includes("Wavenet")) return 2;
  return 1;
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
