import { FinishReason, HarmBlockThreshold, HarmCategory } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { PhraseTranslationError, translatePhraseContent, translationConfig } from "./translate.js";
import type { LessonModelClient } from "./gemini.js";

function client(responses: Array<{ text?: string; blocked?: boolean }>): LessonModelClient & { contents: string[] } {
  const contents: string[] = [];
  return {
    contents,
    generateContent: vi.fn(async (request) => {
      contents.push(request.contents);
      const next = responses[contents.length - 1] ?? { text: "" };
      if (next.blocked) return { text: undefined, candidates: [{ finishReason: FinishReason.SAFETY }] };
      return { text: next.text ?? "", candidates: [{ finishReason: FinishReason.STOP }] };
    }),
  };
}

const input = {
  text: "How would you say I need to buy a pair of shoes?",
  nativeLanguage: "en-US" as const,
  targetLanguage: "de-DE" as const,
  level: "A2" as const,
};

const valid = {
  ok: true,
  inputLanguage: "native",
  nativeText: "I need to buy a pair of shoes",
  translation: "Ich muss ein Paar Schuhe kaufen.",
  transliteration: "Ich muss ein Paar Schuhe kaufen.",
  alternatives: [
    { label: "to a friend", text: "Ich muss ein Paar Schuhe kaufen." },
    { label: "formally", text: "Ich hätte gern ein Paar Schuhe." },
    { label: "you all", text: "Wir müssen ein Paar Schuhe kaufen." },
  ],
  note: "",
};

describe("phrase translation", () => {
  it("asks for JSON mode without a response schema", () => {
    const config = translationConfig();
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema).toBeUndefined();
    expect(config.responseJsonSchema).toBeUndefined();
    expect(config.safetySettings).toEqual([
      HarmCategory.HARM_CATEGORY_HARASSMENT,
      HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    ].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE })));
  });

  it("parses a translation and drops a duplicate alternative", async () => {
    const model = client([{ text: JSON.stringify(valid) }]);
    const result = await translatePhraseContent(input, model);
    expect(result.translation).toBe("Ich muss ein Paar Schuhe kaufen.");
    expect(result.transliteration).toBeUndefined();
    expect(result.alternatives).toEqual([
      { label: "formally", text: "Ich hätte gern ein Paar Schuhe." },
      { label: "you all", text: "Wir müssen ein Paar Schuhe kaufen." },
    ]);
    expect(result.phraseId).toMatch(/^phrase_[0-9a-f]{8}$/);
    expect(model.contents).toHaveLength(1);
  });

  it("retries malformed JSON once and does not return the model text", async () => {
    const model = client([{ text: "not json at all" }, { text: JSON.stringify(valid) }]);
    const result = await translatePhraseContent(input, model);
    expect(result.nativeText).toBe("I need to buy a pair of shoes");
    expect(model.contents[1]).toContain("REPAIR");
  });

  it("rejects nonsense without storing a model reason", async () => {
    const model = client([{ text: JSON.stringify({ ok: false, reason: "secret model reason" }) }]);
    const error = await translatePhraseContent(input, model).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(PhraseTranslationError);
    expect(error).toMatchObject({ code: "rejected", message: "PHRASE_REJECTED" });
    expect(String(error)).not.toContain("secret model reason");
  });

  it("reports a safety block without the raw response", async () => {
    const model = client([{ blocked: true }, { blocked: true }]);
    const error = await translatePhraseContent(input, model).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(PhraseTranslationError);
    expect(error).toMatchObject({ code: "blocked", message: "PHRASE_BLOCKED" });
  });

  it("keeps a Latin transliteration for Japanese", async () => {
    const model = client([{ text: JSON.stringify({
      ...valid,
      translation: "靴を一足買う必要があります。",
      transliteration: "Kutsu o issoku kau hitsuyou ga arimasu.",
      alternatives: [],
    }) }]);
    const result = await translatePhraseContent({ ...input, targetLanguage: "ja-JP" }, model);
    expect(result.transliteration).toBe("Kutsu o issoku kau hitsuyou ga arimasu.");
  });
});
