import { z } from "zod";

export const languageIds = [
  "ar-EG", "bn-IN", "da-DK", "de-DE", "en-AU", "en-GB", "en-US", "es-ES",
  "es-MX", "fil-PH", "fr-CA", "fr-FR", "gu-IN", "hi-IN", "id-ID", "it-IT",
  "ja-JP", "kn-IN", "ko-KR", "ml-IN", "ms-MY", "nb-NO", "pa-IN", "pl-PL",
  "pt-BR", "pt-PT", "ru-RU", "sv-SE", "ta-IN", "tr-TR", "vi-VN", "zh-TW",
] as const;

export const LanguageIdSchema = z.enum(languageIds);
export type LanguageId = z.infer<typeof LanguageIdSchema>;

export type LanguageConfig = {
  id: LanguageId;
  label: string;
  bcp47: LanguageId;
  googleTtsLanguageCode: string;
  transliteration: boolean;
};

const language = (
  id: LanguageId,
  label: string,
  googleTtsLanguageCode: string = id,
  transliteration = false,
): LanguageConfig => ({ id, label, bcp47: id, googleTtsLanguageCode, transliteration });

// Canonicalized from the legacy app's 32 native-language entries. Voice names are
// resolved from Google's live voice inventory and cached by the backend, so a
// discontinued voice can never silently ship in a mobile binary.
export const languages: readonly LanguageConfig[] = [
  // Cloud TTS has no ar-EG inventory. Arabic voices are published under ar-XA.
  language("ar-EG", "Arabic", "ar-XA", true), language("bn-IN", "Bengali"),
  language("da-DK", "Danish"), language("de-DE", "German"),
  language("en-AU", "English (Australia)"), language("en-GB", "English (UK)"),
  language("en-US", "English (US)"), language("es-ES", "Spanish (Spain)"),
  language("es-MX", "Spanish (Mexico)"), language("fil-PH", "Filipino"),
  language("fr-CA", "French (Canada)"), language("fr-FR", "French (France)"),
  language("gu-IN", "Gujarati"), language("hi-IN", "Hindi"),
  language("id-ID", "Indonesian"), language("it-IT", "Italian"),
  language("ja-JP", "Japanese", "ja-JP", true), language("kn-IN", "Kannada"),
  language("ko-KR", "Korean", "ko-KR", true), language("ml-IN", "Malayalam"),
  language("ms-MY", "Malay"), language("nb-NO", "Norwegian"),
  language("pa-IN", "Punjabi"), language("pl-PL", "Polish"),
  language("pt-BR", "Portuguese (Brazil)"), language("pt-PT", "Portuguese (Portugal)"),
  language("ru-RU", "Russian"), language("sv-SE", "Swedish"),
  language("ta-IN", "Tamil"), language("tr-TR", "Turkish"),
  language("vi-VN", "Vietnamese"), language("zh-TW", "Mandarin Chinese", "cmn-TW", true),
] as const;

export const languageById = Object.fromEntries(
  languages.map((entry) => [entry.id, entry]),
) as Record<LanguageId, LanguageConfig>;
