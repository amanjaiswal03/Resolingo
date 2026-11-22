import { describe, expect, it } from "vitest";
import { decideAttempt, gradePhrase, isHintEcho, phraseMatch } from "./phrase-match";

describe("phrase match", () => {
  it("ignores punctuation, case, and accents", () => {
    expect(phraseMatch("Die Rechnung, bitte.", { verdict: "recalled", heard: "die Rechnung bitte" }, "de-DE").level).toBe("matched");
    expect(gradePhrase("café", "cafe", "fr-FR").level).toBe("matched");
  });

  it("treats about three quarters of the words as correct, and a smaller overlap as close or a retry", () => {
    expect(gradePhrase("Ich möchte einen Kaffee.", "Ich möchte Kaffee", "de-DE")).toMatchObject({ level: "matched", clip: "recalled" });
    expect(gradePhrase("one two three four five", "one two three", "en-US")).toMatchObject({
      level: "close",
      clip: "compare",
      detail: "3 of 5 model words matched in order",
    });
    expect(gradePhrase("one two three four", "one two", "en-US").level).toBe("retry");
    expect(phraseMatch("Ich möchte einen Kaffee.", { verdict: "compare", heard: "Danke schön" }, "de-DE").level).toBe("retry");
  });

  it("accepts a near token and ignores fillers", () => {
    expect(gradePhrase("Kaffee", "Kaffe", "de-DE").level).toBe("matched");
    expect(gradePhrase("Die Rechnung, bitte.", "um die Rechnung bitte", "de-DE").level).toBe("matched");
  });

  it("grades a transcript even when the native verdict was unclear", () => {
    expect(phraseMatch("Ja.", { verdict: "unclear", heard: "Ja" }, "de-DE").level).toBe("matched");
    expect(phraseMatch("Ja.", { verdict: "unclear" }, "de-DE")).toEqual({ level: "unclear" });
  });

  it("compares characters for Japanese, Chinese, and Thai", () => {
    expect(phraseMatch("すみません。", { verdict: "compare", heard: "すみ ません" }, "ja-JP").level).toBe("matched");
    expect(gradePhrase("谢谢", "谢", "zh-TW").level).not.toBe("matched");
    expect(gradePhrase("谢谢你", "谢谢你", "zh-TW").level).toBe("matched");
  });

  it("drops an exact hint echo only when confidence is missing and the audio is too short", () => {
    const phrase = "Ich möchte einen Kaffee.";
    expect(isHintEcho({ expected: phrase, heard: phrase, language: "de-DE", audibleSeconds: 0.2, confidenceKnown: false })).toBe(true);
    expect(isHintEcho({ expected: phrase, heard: phrase, language: "de-DE", audibleSeconds: 1.4, confidenceKnown: false })).toBe(false);
    expect(isHintEcho({ expected: phrase, heard: phrase, language: "de-DE", audibleSeconds: 0.2, confidenceKnown: true })).toBe(false);
    expect(isHintEcho({ expected: "Ja.", heard: "Ja", language: "de-DE", audibleSeconds: 0.4, confidenceKnown: false })).toBe(false);
  });

  it("plays praise, a close line, the catch line, or nothing", () => {
    expect(decideAttempt({
      expected: "Die Rechnung, bitte.", heard: "die rechnung bitte", language: "de-DE",
      audibleSeconds: 1.2, confidenceKnown: false, wasQuiet: false,
    })).toMatchObject({ clip: "recalled", result: { verdict: "recalled" } });
    expect(decideAttempt({
      expected: "one two three four five", heard: "one two three", language: "en-US",
      audibleSeconds: 1, confidenceKnown: false, wasQuiet: false,
    }).clip).toBe("compare");
    expect(decideAttempt({
      expected: "one two three four", heard: "hello", language: "en-US",
      audibleSeconds: 0.8, confidenceKnown: true, wasQuiet: false,
    })).toMatchObject({ clip: "unclear", result: { heard: "hello" } });
    expect(decideAttempt({
      expected: "Ja.", heard: "", language: "de-DE", audibleSeconds: 0.02, confidenceKnown: false, wasQuiet: true,
    })).toEqual({ result: { verdict: "skipped" }, clip: "skipped" });
    expect(decideAttempt({
      expected: "Ich möchte einen Kaffee.", heard: "Ich möchte einen Kaffee.", language: "de-DE",
      audibleSeconds: 0.15, confidenceKnown: false, wasQuiet: false,
    })).toMatchObject({ clip: "unclear", result: { verdict: "unclear" } });
  });

  it("keeps the better of two partial transcripts", () => {
    const grade = decideAttempt({
      expected: "Die Rechnung, bitte.",
      heard: "die",
      alternate: "die Rechnung bitte",
      language: "de-DE",
      audibleSeconds: 1.3,
      confidenceKnown: false,
      wasQuiet: false,
    });
    expect(grade.result).toMatchObject({ verdict: "recalled", heard: "die Rechnung bitte" });
  });
});
