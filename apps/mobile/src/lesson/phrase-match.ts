import type { LanguageId } from "@resolingo/shared";

export type VoiceVerdict = "recalled" | "compare" | "unclear" | "skipped";
export type VoiceResult = { verdict: VoiceVerdict | "checking"; heard?: string };
export type PhraseMatch = { level: "matched" | "close" | "retry" | "unclear" | "skipped" | "checking"; heard?: string; detail?: string };

function tokens(text: string, language: LanguageId): string[] {
  return text.normalize("NFKC").toLocaleLowerCase(language).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/** Count words recognized in order, ignoring case and punctuation. */
export function phraseMatch(expected: string, result: VoiceResult, language: LanguageId): PhraseMatch {
  if (result.verdict === "unclear" || result.verdict === "skipped" || result.verdict === "checking") {
    return { level: result.verdict };
  }
  const heard = result.heard?.trim();
  if (!heard) return { level: result.verdict === "recalled" ? "matched" : "retry" };

  // Spaces do not consistently separate words in these writing systems.
  const code = language.split("-")[0];
  const wordBased = code !== "zh" && code !== "ja" && code !== "th";
  const tokenize = (value: string) => {
    const runs = tokens(value, language);
    return wordBased ? runs : Array.from(runs.join(""));
  };
  const model = tokenize(expected);
  const actual = tokenize(heard);
  if (!model.length || !actual.length) return { level: "unclear" };
  if (model.length === actual.length && model.every((token, index) => token === actual[index])) {
    return { level: "matched", heard };
  }

  let previous = Array<number>(actual.length + 1).fill(0);
  for (const expectedToken of model) {
    const row = [0];
    for (const [index, spokenToken] of actual.entries()) {
      row.push(expectedToken === spokenToken
        ? previous[index]! + 1
        : Math.max(row[index]!, previous[index + 1]!));
    }
    previous = row;
  }
  const matched = previous[actual.length]!;
  const level = matched / Math.max(model.length, actual.length) >= 0.6 ? "close" : "retry";
  return {
    level,
    heard,
    ...(wordBased && matched < model.length ? { detail: `${matched} of ${model.length} model words matched in order` } : {}),
  };
}
