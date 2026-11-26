import { languageById, type LanguageId } from "@resolingo/shared";

/**
 * The flag emoji for a language's region, built from the region in its id
 * (de-DE gives 🇩🇪). Emoji flags need no image assets and render on iOS and Android.
 */
export function languageFlag(id: LanguageId): string {
  const region = id.split("-")[1]?.toUpperCase();
  if (!region || !/^[A-Z]{2}$/.test(region)) return "🌐";
  return String.fromCodePoint(...[...region].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

export function languageLabel(id: LanguageId): string {
  return languageById[id]?.label ?? id;
}
