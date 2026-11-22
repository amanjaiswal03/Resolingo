import { languageIds } from "@resolingo/shared";
import { describe, expect, it } from "vitest";
import { answerFeedbackLines } from "./answer-feedback-lines.js";

const postponed = [
  "later", "später", "más tarde", "plus tard", "più tardi", "mais tarde", "senere",
  "później", "позже", "sonra", "nanti", "mamaya",
];

describe("calm check clips", () => {
  it("gives every native language two close lines and one unclear line", () => {
    expect(Object.keys(answerFeedbackLines).sort()).toEqual([...languageIds].sort());
    for (const id of languageIds) {
      const lines = answerFeedbackLines[id];
      const all = [...lines.close, lines.unclear];
      expect(all).toHaveLength(3);
      for (const text of all) {
        expect(text.trim().length).toBeGreaterThan(1);
        expect(text.length).toBeLessThan(80);
        const folded = text.toLocaleLowerCase();
        for (const word of postponed) expect(folded).not.toContain(word);
      }
    }
  });

  it("uses the calm English wording", () => {
    expect(answerFeedbackLines["en-US"]).toEqual({
      close: ["Close.", "Nearly."],
      unclear: "I didn’t quite catch that.",
    });
  });
});
