import { describe, expect, it } from "vitest";
import { phraseMatch } from "./phrase-match";

describe("phrase match", () => {
  it("ignores punctuation and case in a matching German phrase", () => {
    expect(phraseMatch("Die Rechnung, bitte.", { verdict: "recalled", heard: "die Rechnung bitte" }, "de-DE").level).toBe("matched");
  });

  it("shows which range a partial or different reply falls into", () => {
    const expected = "Ich möchte einen Kaffee.";
    expect(phraseMatch(expected, { verdict: "compare", heard: "Ich möchte Kaffee" }, "de-DE")).toMatchObject({
      level: "close",
      detail: "3 of 4 model words matched in order",
    });
    expect(phraseMatch(expected, { verdict: "compare", heard: "Danke schön" }, "de-DE").level).toBe("retry");
  });

  it("does not grade an uncertain transcription", () => {
    expect(phraseMatch("Ja.", { verdict: "unclear", heard: "Ja" }, "de-DE")).toEqual({ level: "unclear" });
  });

  it("tolerates different spacing in Japanese recognition", () => {
    expect(phraseMatch("すみません。", { verdict: "compare", heard: "すみ ません" }, "ja-JP").level).toBe("matched");
  });
});
