import { languageIds, speakPrefix } from "@resolingo/shared";
import { describe, expect, it } from "vitest";
import { PhraseTranslationError } from "./translate.js";
import {
  SPEECH_LOCATION,
  SPEECH_MODEL,
  speechLanguageCode,
  speechRecognizeRequest,
  transcriptFromRecognize,
  transcribeWithSpeechToText,
} from "./stt.js";

describe("speech language codes", () => {
  it("uses the Chirp 2 tag for every native language", () => {
    expect(speechLanguageCode("en-US")).toBe("en-US");
    expect(speechLanguageCode("fil-PH")).toBe("fil-PH");
    expect(speechLanguageCode("ar-EG")).toBe("ar-EG");
    expect(speechLanguageCode("nb-NO")).toBe("no-NO");
    expect(speechLanguageCode("pa-IN")).toBe("pa-Guru-IN");
    expect(speechLanguageCode("zh-TW")).toBe("cmn-Hant-TW");
    for (const id of languageIds) expect(speechLanguageCode(id).length).toBeGreaterThan(0);
  });
});

describe("speech recognize request", () => {
  it("asks Chirp 2 in europe-west4 to auto-decode the recording and punctuate it", () => {
    const audio = Buffer.from("m4a-bytes");
    const request = speechRecognizeRequest({ projectId: "resolingo", language: "zh-TW", audio });
    expect(request.recognizer).toBe(`projects/resolingo/locations/${SPEECH_LOCATION}/recognizers/_`);
    expect(request.config).toEqual({
      model: SPEECH_MODEL,
      languageCodes: ["cmn-Hant-TW"],
      autoDecodingConfig: {},
      features: { enableAutomaticPunctuation: true },
    });
    expect(request.content).toBe(audio);
    expect(JSON.stringify(request.config)).not.toContain(audio.toString("base64"));
  });

  it("joins the transcript and treats an empty result as silence", async () => {
    const audioBase64 = Buffer.from("m4a-bytes").toString("base64");
    const heard = await transcribeWithSpeechToText({
      audioBase64,
      nativeLanguage: "de-DE",
      projectId: "resolingo",
    }, async (request) => {
      expect(request.config.languageCodes).toEqual(["de-DE"]);
      expect(request.content.toString()).toBe("m4a-bytes");
      return { results: [{ alternatives: [{ transcript: "Ich brauche Schuhe." }] }, { alternatives: [{ transcript: "" }] }] };
    });
    expect(heard).toBe("Ich brauche Schuhe.");
    expect(transcriptFromRecognize({
      results: [{ alternatives: [{ transcript: `${speakPrefix("de-DE")}: Ich brauche Schuhe` }] }],
    }, "de-DE")).toBe("Ich brauche Schuhe");
    expect(transcriptFromRecognize({
      results: [{ alternatives: [{ transcript: `${speakPrefix("fr-FR")} des chaussures` }] }],
    }, "fr-FR")).toBe("des chaussures");
    expect(transcriptFromRecognize({ results: [] })).toBe("");
    await expect(transcribeWithSpeechToText({
      audioBase64,
      nativeLanguage: "en-US",
      projectId: "resolingo",
    }, async () => ({ results: [{ alternatives: [{ transcript: "..." }] }] }))).rejects.toBeInstanceOf(PhraseTranslationError);
  });
});
