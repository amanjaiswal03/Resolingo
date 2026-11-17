import { FinishReason, HarmBlockThreshold, HarmCategory } from "@google/genai";
import { phraseIdFor } from "@resolingo/shared";
import { describe, expect, it, vi } from "vitest";
import { PhraseTranslationError, transcribePhraseAudio, translatePhraseContent, translateSpokenPhrase, transcriptionPrompt, translationConfig } from "./translate.js";
import type { LessonModelClient } from "./gemini.js";

function client(responses: Array<{ text?: string; blocked?: boolean }>): LessonModelClient & { contents: string[]; systems: string[] } {
  const contents: string[] = [];
  const systems: string[] = [];
  return {
    contents,
    systems,
    generateContent: vi.fn(async (request) => {
      contents.push(typeof request.contents === "string" ? request.contents : JSON.stringify(request.contents));
      systems.push(typeof request.config?.systemInstruction === "string" ? request.config.systemInstruction : "");
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

  it("transcribes speech in the native language and can translate it in the same call", async () => {
    const audioBase64 = Buffer.alloc(900, 7).toString("base64");
    const heard = client([{ text: JSON.stringify({ ok: true, nativeText: "I need to buy a pair of shoes" }) }]);
    const transcript = await transcribePhraseAudio({ audioBase64, mimeType: "audio/m4a", nativeLanguage: "en-US" }, heard);
    expect(transcript).toBe("I need to buy a pair of shoes");
    const sent = JSON.parse(heard.contents[0] ?? "{}") as { parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> };
    expect(sent.parts[0]?.inlineData).toEqual({ mimeType: "audio/mp4", data: audioBase64 });
    expect(sent.parts[1]?.text).toContain("English (US)");
    expect(heard.systems[0]).toContain("transcribe");
    expect(heard.systems[0]).not.toContain("alternatives");
    expect(sent.parts[1]?.text).toContain(transcriptionPrompt("en-US").slice(0, 40));
    expect(sent.parts[1]?.text).not.toContain(audioBase64);

    const spoken = client([{ text: JSON.stringify(valid) }]);
    const result = await translateSpokenPhrase({
      audioBase64,
      mimeType: "audio/m4a",
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "A2",
    }, spoken);
    expect(result.nativeText).toBe("I need to buy a pair of shoes");
    expect(result.translation).toBe("Ich muss ein Paar Schuhe kaufen.");
    expect(result.phraseId).toBe(phraseIdFor("de-DE", "A2", transcript));
  });

  it("treats silent audio as nothing to store", async () => {
    const audioBase64 = Buffer.alloc(900, 7).toString("base64");
    const model = client([{ text: JSON.stringify({ ok: false, reason: "quiet room" }) }]);
    const error = await transcribePhraseAudio({ audioBase64, mimeType: "audio/wav", nativeLanguage: "en-US" }, model).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(PhraseTranslationError);
    expect(error).toMatchObject({ code: "silent", message: "PHRASE_SILENT" });
    expect(String(error)).not.toContain("quiet room");
    expect(String(error)).not.toContain(audioBase64);
    const empty = client([{ text: JSON.stringify({ ok: true, nativeText: "..." }) }]);
    await expect(transcribePhraseAudio({ audioBase64, mimeType: "audio/m4a", nativeLanguage: "en-US" }, empty)).rejects.toMatchObject({ code: "silent" });
  });
});
