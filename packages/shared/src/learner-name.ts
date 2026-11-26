import type { LanguageId } from "./languages.js";
import { teachingLanguage } from "./teaching.js";

/**
 * Lessons can address the learner by first name. The model never sees the
 * name: it writes the placeholder {learner}, and the backend fills it in (or
 * takes it out) after the lesson is shaped.
 */
export const LEARNER_PLACEHOLDER = "{learner}";

/** At most this many teacher lines in one lesson say the learner's name. */
export const MAX_NAME_MENTIONS = 2;

/** A short greeting that opens a lesson when the model did not use the name itself. */
const GREETING: Partial<Record<LanguageId, string>> = {
  "en-US": "Hi {learner}.",
  "de-DE": "Hallo {learner}.",
  "fr-FR": "Bonjour {learner}.",
  "es-ES": "Hola, {learner}.",
  "es-MX": "Hola, {learner}.",
  "it-IT": "Ciao {learner}.",
  "pt-BR": "Oi, {learner}.",
  "pt-PT": "Olá, {learner}.",
  "da-DK": "Hej {learner}.",
  "sv-SE": "Hej {learner}.",
  "nb-NO": "Hei {learner}.",
  "pl-PL": "Cześć, {learner}.",
  "ru-RU": "Привет, {learner}.",
  "tr-TR": "Merhaba {learner}.",
  "ar-EG": "مرحبًا يا {learner}.",
  "hi-IN": "नमस्ते {learner}।",
  "bn-IN": "হ্যালো {learner}।",
  "gu-IN": "નમસ્તે {learner}.",
  "kn-IN": "ನಮಸ್ಕಾರ {learner}.",
  "ml-IN": "നമസ്കാരം {learner}.",
  "pa-IN": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ {learner}।",
  "ta-IN": "வணக்கம் {learner}.",
  "ja-JP": "こんにちは、{learner}さん。",
  "ko-KR": "안녕하세요, {learner} 님.",
  "zh-TW": "{learner}，你好。",
  "vi-VN": "Chào {learner}.",
  "id-ID": "Halo, {learner}.",
  "ms-MY": "Hai {learner}.",
  "fil-PH": "Kumusta, {learner}.",
};

export function learnerGreeting(language: LanguageId): string {
  return GREETING[teachingLanguage(language)] ?? GREETING["en-US"]!;
}

/**
 * The first name to use in lessons, from the profile nickname or the sign-in
 * display name. Returns undefined when there is nothing that reads as a name.
 */
export function learnerFirstName(profile: { nickname?: unknown; displayName?: unknown } | undefined): string | undefined {
  for (const value of [profile?.nickname, profile?.displayName]) {
    if (typeof value !== "string") continue;
    const first = value.normalize("NFC").trim().split(/\s+/u)[0] ?? "";
    const cleaned = first.replace(/[^\p{L}\p{M}'’.-]/gu, "").replace(/^[-'’.]+|[-'’.]+$/gu, "");
    if (cleaned.length > 0 && cleaned.length <= 24 && /\p{L}/u.test(cleaned)) return cleaned;
  }
  return undefined;
}

/** Removes the placeholder and the comma or honorific that went with it, so the line still reads well. */
export function stripLearnerPlaceholder(text: string): string {
  if (!text.includes(LEARNER_PLACEHOLDER)) return text;
  const stripped = text
    .replace(/[ \t]*([,，、،]?)[ \t]*(?:يا[ \t]+)?\{learner\}[ \t]*(?:さん|様|くん|ちゃん|님|씨)?[ \t]*([,，、،]?)/gu, (_match, lead: string, trail: string, offset: number, whole: string) => (
      // "Hi {learner}, today" keeps its comma: "Hi, today". "Welcome, {learner}, to" loses both.
      trail && !lead && /\p{L}$/u.test(whole.slice(0, offset)) ? `${trail} ` : " "
    ))
    .replace(/\s+([.!?,;:。！？，、])/gu, "$1")
    .replace(/([.!?。！？])\s*[.!?。！？]+/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
  return stripped.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase());
}

type NamedSegment = { speaker: string; language: string; text: string; phase?: string | undefined; translation?: string | undefined };

/**
 * Fills {learner} with the learner's first name in a few teacher lines: once
 * near the start and once in the closing. Every other placeholder, and every
 * placeholder outside a teaching-language teacher line, is taken out. When the
 * model did not greet the learner by name, a short greeting opens the lesson.
 * Without a name, every placeholder is removed and nothing is added.
 */
export function personalizeSegments<T extends NamedSegment>(segments: readonly T[], name: string | undefined, teaching: LanguageId): T[] {
  const spoken = (segment: T) => segment.speaker === "teacher" && segment.language === teaching;
  const has = (segment: T) => segment.text.includes(LEARNER_PLACEHOLDER);
  const keep = new Set<number>();
  if (name) {
    const opening = segments.findIndex((segment) => spoken(segment) && segment.phase === "intro" && has(segment));
    if (opening >= 0) keep.add(opening);
    let closing = -1;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index]!;
      if (spoken(segment) && segment.phase === "closing" && has(segment)) { closing = index; break; }
    }
    if (closing >= 0 && keep.size < MAX_NAME_MENTIONS) keep.add(closing);
  }
  // Only the first placeholder in a kept line is filled. A second one in the same line is dropped.
  const fill = (text: string) => stripLearnerPlaceholder(text.replace(LEARNER_PLACEHOLDER, name ?? LEARNER_PLACEHOLDER));
  const greeted = [...keep].some((index) => segments[index]!.phase === "intro");
  const result = segments.flatMap((segment, index) => {
    const text = keep.has(index) ? fill(segment.text) : stripLearnerPlaceholder(segment.text);
    const translation = segment.translation === undefined ? undefined : stripLearnerPlaceholder(segment.translation);
    if (text === segment.text && translation === segment.translation) return [segment];
    // A line that was only the placeholder has nothing left to say.
    if (!/[\p{L}\p{N}]/u.test(text)) return [];
    return [{ ...segment, text, ...(translation === undefined ? {} : { translation }) }];
  });
  if (!name || greeted) return result;
  const first = result.findIndex((segment) => spoken(segment));
  if (first < 0) return result;
  const greeting = learnerGreeting(teaching).replace(LEARNER_PLACEHOLDER, name);
  const target = result[first]!;
  result[first] = { ...target, text: `${greeting} ${target.text}`.slice(0, 900) };
  return result;
}
