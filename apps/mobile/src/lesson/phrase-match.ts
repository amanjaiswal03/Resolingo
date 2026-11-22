import type { LanguageId } from "@resolingo/shared";

export type VoiceVerdict = "recalled" | "compare" | "unclear" | "skipped";
export type VoiceResult = { verdict: VoiceVerdict | "checking"; heard?: string };
export type PhraseMatch = { level: "matched" | "close" | "retry" | "unclear" | "skipped" | "checking"; heard?: string; detail?: string };
export type FeedbackClip = "recalled" | "compare" | "unclear" | "skipped";

const FILLERS = new Set(["um", "uh", "er", "ah", "eh", "ahm", "hmm", "hm", "erm", "mhm", "euh"]);
const ARTICLES: Record<string, readonly string[]> = {
  en: ["a", "an", "the"],
  de: ["der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer"],
  es: ["el", "la", "los", "las", "un", "una", "unos", "unas"],
  fr: ["le", "la", "les", "un", "une", "des"],
  it: ["il", "lo", "la", "i", "gli", "le", "un", "uno", "una"],
  pt: ["o", "a", "os", "as", "um", "uma"],
  nl: ["de", "het", "een"],
};

/** Correct at about 75%. Close is the band just under that. */
export const MATCH_SCORE = 0.75;
export const CLOSE_SCORE = 0.55;
/** Below this, the microphone heard no voice. Same floor as the native level meter. */
export const NO_VOICE_SECONDS = 0.045;

/**
 * A recognizer can echo contextualStrings without the learner saying them.
 * An exact copy with unknown confidence and too little audio is discarded.
 */
export function isHintEcho(input: {
  expected: string;
  heard: string;
  language: LanguageId;
  audibleSeconds: number;
  confidenceKnown: boolean;
}): boolean {
  if (input.confidenceKnown) return false;
  const expected = normalize(input.expected, input.language);
  const heard = normalize(input.heard, input.language);
  if (!expected || !heard || expected !== heard) return false;
  const words = scriptOf(input.language) === "words" ? tokenize(input.expected, input.language).length : 1;
  return input.audibleSeconds < Math.max(0.28, words * 0.22);
}

export function gradePhrase(expected: string, heard: string, language: LanguageId): PhraseMatch & { score: number; clip: FeedbackClip } {
  const model = contentTokens(expected, language, "expected");
  const actual = contentTokens(heard, language, "heard");
  if (!model.length || !actual.length) return { level: "unclear", score: 0, clip: "unclear" };
  const matched = scriptOf(language) === "words" ? fuzzyLcs(model, actual) : charactersMatched(model.join(""), actual.join(""));
  const score = matched / Math.max(model.length, actual.length);
  const level = score >= MATCH_SCORE ? "matched" : score >= CLOSE_SCORE ? "close" : "retry";
  const wordBased = scriptOf(language) === "words";
  return {
    level,
    score,
    heard: heard.trim(),
    clip: level === "matched" ? "recalled" : level === "close" ? "compare" : "unclear",
    ...(wordBased && matched < model.length ? { detail: `${matched} of ${model.length} model words matched in order` } : {}),
  };
}

/** Grade every candidate and keep the one that scores highest. */
export function gradeBest(expected: string, heardOptions: readonly string[], language: LanguageId): PhraseMatch & { score: number; clip: FeedbackClip } {
  const usable = heardOptions.map((option) => option.trim()).filter(Boolean);
  if (!usable.length) return { level: "unclear", score: 0, clip: "unclear" };
  return usable.map((option) => gradePhrase(expected, option, language)).reduce((best, grade) => grade.score > best.score ? grade : best);
}

/** Turn a native transcript into the stored result and the clip to play. */
export function decideAttempt(input: {
  expected: string;
  heard?: string;
  alternate?: string;
  language: LanguageId;
  audibleSeconds: number;
  confidenceKnown: boolean;
  wasQuiet: boolean;
}): { result: VoiceResult; clip: FeedbackClip } {
  // No voice is a skip, even if the recognizer echoed the hint. It is not a miss.
  if (input.audibleSeconds < NO_VOICE_SECONDS) {
    return { result: { verdict: "skipped" }, clip: "skipped" };
  }
  const keep = (text: string | undefined) => {
    const heard = text?.trim() ?? "";
    if (!heard) return "";
    return isHintEcho({ ...input, heard }) ? "" : heard;
  };
  const options = [keep(input.heard), keep(input.alternate)].filter(Boolean);
  if (!options.length) {
    return input.wasQuiet
      ? { result: { verdict: "skipped" }, clip: "skipped" }
      : { result: { verdict: "unclear" }, clip: "unclear" };
  }
  const grade = gradeBest(input.expected, options, input.language);
  if (grade.level === "unclear") {
    return input.wasQuiet
      ? { result: { verdict: "skipped" }, clip: "skipped" }
      : { result: { verdict: "unclear", ...(grade.heard ? { heard: grade.heard } : {}) }, clip: "unclear" };
  }
  const verdict = grade.level === "matched" ? "recalled" : grade.level === "close" ? "compare" : "unclear";
  return { result: { verdict, ...(grade.heard ? { heard: grade.heard } : {}) }, clip: grade.clip };
}

/** Count words recognized in order. A native "unclear" still grades when it kept the transcript. */
export function phraseMatch(expected: string, result: VoiceResult, language: LanguageId): PhraseMatch {
  if (result.verdict === "skipped" || result.verdict === "checking") return { level: result.verdict };
  const heard = result.heard?.trim();
  if (!heard) {
    if (result.verdict === "recalled") return { level: "matched" };
    if (result.verdict === "unclear") return { level: "unclear" };
    return { level: "retry" };
  }
  const { level, detail } = gradePhrase(expected, heard, language);
  return { level, heard, ...(detail ? { detail } : {}) };
}

function scriptOf(language: LanguageId): "words" | "characters" {
  const code = language.split("-")[0];
  return code === "zh" || code === "ja" || code === "th" ? "characters" : "words";
}

function contentTokens(text: string, language: LanguageId, side: "expected" | "heard"): string[] {
  const runs = tokenize(text, language);
  if (scriptOf(language) === "characters") return Array.from(runs.join(""));
  const code = language.split("-")[0] ?? "";
  const withoutFillers = side === "heard" ? runs.filter((token) => !FILLERS.has(token)) : runs;
  const articles = ARTICLES[code];
  if (!articles) return withoutFillers;
  const kept = withoutFillers.filter((token) => !articles.includes(token));
  return kept.length ? kept : withoutFillers;
}

function tokenize(text: string, language: LanguageId): string[] {
  return normalize(text, language).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

function normalize(text: string, language: LanguageId): string {
  return text.normalize("NFKC").toLocaleLowerCase(language).normalize("NFD").replace(/\p{M}+/gu, "");
}

function fuzzyLcs(model: string[], actual: string[]): number {
  let previous = Array<number>(actual.length + 1).fill(0);
  for (const expectedToken of model) {
    const row = [0];
    for (const [index, spokenToken] of actual.entries()) {
      row.push(tokensClose(expectedToken, spokenToken)
        ? previous[index]! + 1
        : Math.max(row[index]!, previous[index + 1]!));
    }
    previous = row;
  }
  return previous[actual.length]!;
}

function tokensClose(expected: string, spoken: string): boolean {
  if (expected === spoken) return true;
  const scale = Math.max(expected.length, spoken.length);
  if (!scale) return true;
  return 1 - levenshtein(expected, spoken) / scale >= MATCH_SCORE;
}

function charactersMatched(expected: string, spoken: string): number {
  const scale = Math.max(expected.length, spoken.length);
  if (!scale) return 0;
  return scale - levenshtein(expected, spoken);
}

function levenshtein(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  let previous = b.map((_, index) => index + 1);
  previous.unshift(0);
  for (let i = 0; i < a.length; i += 1) {
    const row = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      row.push(Math.min(row[j]! + 1, previous[j + 1]! + 1, previous[j]! + cost));
    }
    previous = row;
  }
  return previous[b.length]!;
}
