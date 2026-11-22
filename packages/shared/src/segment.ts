import type { LanguageId } from "./languages.js";

/**
 * Sentence and word breaks for lesson text.
 *
 * Cloud Functions run on Node 22, which ships full ICU, so Intl.Segmenter
 * splits Japanese, Korean, Mandarin, and Thai. Hermes in the React Native
 * app does not implement Intl.Segmenter. Lesson shaping runs on the server.
 * If this module is ever called where Segmenter is missing, a smaller
 * fallback still splits sentences and keeps CJK from staying one blob.
 */

const SENTENCE_END = new Set([".", "!", "?", "。", "！", "？", "．"]);

const ABBREVIATIONS = new Set(
  ["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie", "fig", "vol", "inc", "ltd", "co", "gen", "mt", "ft", "ca", "nr", "bzw", "usw", "phd", "md", "ba", "ma", "mme", "mlle"],
);

const JA_CLITIC = /^(?:は|が|を|に|で|と|も|の|へ|や|か|ね|よ|わ|ぞ|さ|な|だ|です|ます|た|て|し|から|まで|より|って|ですか|ますか|でした|ました|ません)$/u;
const KO_CLITIC = /^(?:은|는|이|가|을|를|에|에서|으로|요|까|의|도|만|예요|이에요|어요|아요|세요|습니까|입니다)$/u;
const ZH_CLITIC = /^(?:的|了|吗|呢|吧|啊|嘛)$/u;

const KO_ENDINGS = ["입니까", "입니다", "이에요", "예요", "어요", "아요", "세요", "주세요", "에서", "으로", "어디", "은", "는", "이", "가", "을", "를", "에", "요", "까", "의", "도", "만"]
  .sort((left, right) => right.length - left.length);

const segmenters = new Map<string, Intl.Segmenter | null>();

export function segmenterAvailable(): boolean {
  return typeof Intl !== "undefined" && typeof Intl.Segmenter === "function";
}

function segmenterFor(locale: string): Intl.Segmenter | null {
  const key = locale || "en";
  const cached = segmenters.get(key);
  if (cached !== undefined) return cached;
  if (!segmenterAvailable()) {
    segmenters.set(key, null);
    return null;
  }
  try {
    const segmenter = new Intl.Segmenter(key, { granularity: "word" });
    segmenters.set(key, segmenter);
    return segmenter;
  } catch {
    segmenters.set(key, null);
    return null;
  }
}

function isHangul(text: string): boolean {
  return /\p{Script=Hangul}/u.test(text);
}

function isKanaOrHan(text: string): boolean {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text);
}

export function needsWordSegment(text: string): boolean {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Thai}/u.test(text);
}

function peelKorean(token: string): string[] {
  const chars = [...token];
  if (chars.length < 6) return [token];
  const parts: string[] = [];
  let rest = token;
  while (rest.length > 0) {
    const ending = KO_ENDINGS.find((item) => rest.endsWith(item) && rest.length > item.length);
    if (!ending) {
      parts.unshift(rest);
      break;
    }
    parts.unshift(ending);
    rest = rest.slice(0, -ending.length);
  }
  return parts.length > 1 ? parts : [token];
}

function fallbackWords(text: string): string[] {
  const rough = text.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0);
  const words: string[] = [];
  for (const token of rough) {
    if (isHangul(token)) words.push(...peelKorean(token));
    else if (needsWordSegment(token) && [...token].length > 1) words.push(...[...token]);
    else words.push(token);
  }
  return words;
}

/** Words in reading order. Punctuation is left out. */
export function segmentWords(text: string, locale: LanguageId | string = "en-US"): string[] {
  const normalized = text.normalize("NFC");
  const segmenter = segmenterFor(locale);
  const raw = segmenter
    ? [...segmenter.segment(normalized)].filter((part) => part.isWordLike).map((part) => part.segment)
    : fallbackWords(normalized);
  const words: string[] = [];
  for (const token of raw) {
    if (isHangul(token) && [...token].length >= 6) words.push(...peelKorean(token));
    else words.push(token);
  }
  return words.filter((word) => word.trim().length > 0);
}

export function isClitic(word: string, locale: LanguageId | string = "en-US"): boolean {
  if (locale.startsWith("ko") || isHangul(word)) return KO_CLITIC.test(word);
  if (locale.startsWith("zh") || (/\p{Script=Han}/u.test(word) && !/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(word))) return ZH_CLITIC.test(word);
  if (locale.startsWith("ja") || isKanaOrHan(word)) return JA_CLITIC.test(word);
  return false;
}

/**
 * Content word plus the particles that follow it.
 * 駅 / は / どこ / です / か becomes 駅は / どこですか.
 */
export function groupBunsetsu(words: readonly string[], locale: LanguageId | string = "en-US"): string[] {
  const groups: string[] = [];
  for (const word of words) {
    if (groups.length > 0 && isClitic(word, locale)) groups[groups.length - 1] += word;
    else groups.push(word);
  }
  return groups;
}

function lastAbbrev(before: string): string {
  const token = before.match(/[\p{L}\p{M}]+(?:\.[\p{L}\p{M}]+)*$/u)?.[0] ?? "";
  const piece = token.split(".").at(-1) ?? "";
  return piece.toLocaleLowerCase("en-US");
}

function keepsPeriod(text: string, index: number): boolean {
  const previous = text[index - 1] ?? "";
  const next = text[index + 1] ?? "";
  if (/\p{N}/u.test(previous) && /\p{N}/u.test(next)) return true;
  if (text[index - 1] === "." || text[index + 1] === ".") return true;
  const abbrev = lastAbbrev(text.slice(0, index));
  if (!abbrev) return false;
  if ([...abbrev].length === 1) return true;
  return ABBREVIATIONS.has(abbrev);
}

/**
 * Split after 。！？． and after .!? even when the next sentence is not spaced.
 * Opening ¿¡ stay on the sentence they open. Decimals and abbreviations stay put.
 */
export function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const mark = text[index] ?? "";
    if (!SENTENCE_END.has(mark)) continue;
    if ((mark === "." || mark === "．") && keepsPeriod(text, index)) continue;
    let end = index + 1;
    while (end < text.length && SENTENCE_END.has(text[end] ?? "") && text[end] !== "." && text[end] !== "．") end += 1;
    const sentence = text.slice(start, end).trim();
    if (sentence && /[\p{L}\p{N}]/u.test(sentence)) parts.push(sentence);
    while (end < text.length && /\s/u.test(text[end] ?? "")) end += 1;
    start = end;
    index = end - 1;
  }
  const tail = text.slice(start).trim();
  if (tail && /[\p{L}\p{N}]/u.test(tail)) parts.push(tail);
  return parts;
}
