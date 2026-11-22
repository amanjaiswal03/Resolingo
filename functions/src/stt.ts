import { languageIds, stripSpeakPrefix, type LanguageId } from "@resolingo/shared";
import { PhraseTranslationError } from "./translate.js";

/** Chirp 2 is in europe-west4, not the multi-region `eu` location. */
export const SPEECH_LOCATION = "europe-west4";
export const SPEECH_MODEL = "chirp_2";
export const SPEECH_ENDPOINT = `${SPEECH_LOCATION}-speech.googleapis.com`;

/**
 * Chirp 2 on europe-west4 uses these BCP-47 tags. The rest of our language ids
 * already match the model's tags, including fil-PH and ar-EG.
 * https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages
 */
const SPEECH_LANGUAGE_CODE: Record<LanguageId, string> = {
  ...Object.fromEntries(languageIds.map((id) => [id, id])),
  "nb-NO": "no-NO",
  "pa-IN": "pa-Guru-IN",
  "zh-TW": "cmn-Hant-TW",
} as Record<LanguageId, string>;

export function speechLanguageCode(language: LanguageId): string {
  return SPEECH_LANGUAGE_CODE[language];
}

export type SpeechRecognizeRequest = {
  recognizer: string;
  config: {
    model: typeof SPEECH_MODEL;
    languageCodes: [string];
    autoDecodingConfig: Record<string, never>;
    features: { enableAutomaticPunctuation: true };
  };
  content: Buffer;
};

export type SpeechRecognizeResponse = {
  results?: Array<{ alternatives?: Array<{ transcript?: string | null | undefined }> | null }> | null;
};

/**
 * Inline recognizer `_` plus auto decoding. Cloud Speech-to-Text V2 auto-detects
 * M4A_AAC and MP4_AAC, which is what the app records on iOS and Android.
 */
export function speechRecognizeRequest(input: {
  projectId: string;
  language: LanguageId;
  audio: Buffer;
}): SpeechRecognizeRequest {
  return {
    recognizer: `projects/${input.projectId}/locations/${SPEECH_LOCATION}/recognizers/_`,
    config: {
      model: SPEECH_MODEL,
      languageCodes: [speechLanguageCode(input.language)],
      autoDecodingConfig: {},
      features: { enableAutomaticPunctuation: true },
    },
    content: input.audio,
  };
}

export function transcriptFromRecognize(response: SpeechRecognizeResponse, language: LanguageId = "en-US"): string {
  const joined = (response.results ?? [])
    .map((result) => result.alternatives?.[0]?.transcript ?? "")
    .join(" ");
  return stripSpeakPrefix(joined, language)
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 280);
}

type Recognize = (request: SpeechRecognizeRequest) => Promise<SpeechRecognizeResponse>;

let recognizeCached: Recognize | null = null;

async function defaultRecognize(request: SpeechRecognizeRequest): Promise<SpeechRecognizeResponse> {
  let recognize = recognizeCached;
  if (!recognize) {
    const { v2 } = await import("@google-cloud/speech");
    const client = new v2.SpeechClient({ apiEndpoint: SPEECH_ENDPOINT });
    recognize = async (next) => {
      const [response] = await client.recognize(next);
      return {
        results: (response.results ?? []).map((result) => ({
          alternatives: (result.alternatives ?? []).map((alternative) => ({
            transcript: alternative.transcript ?? null,
          })),
        })),
      };
    };
    recognizeCached = recognize;
  }
  return recognize(request);
}

export async function transcribeWithSpeechToText(input: {
  audioBase64: string;
  nativeLanguage: LanguageId;
  projectId: string;
}, recognize: Recognize = defaultRecognize): Promise<string> {
  const audio = Buffer.from(input.audioBase64, "base64");
  const response = await recognize(speechRecognizeRequest({
    projectId: input.projectId,
    language: input.nativeLanguage,
    audio,
  }));
  const transcript = transcriptFromRecognize(response, input.nativeLanguage);
  if (!/[\p{L}\p{N}]/u.test(transcript)) throw new PhraseTranslationError("silent");
  return transcript;
}
