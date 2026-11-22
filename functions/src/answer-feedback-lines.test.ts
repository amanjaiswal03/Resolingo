import { languageIds } from "@resolingo/shared";
import { describe, expect, it } from "vitest";
import { answerFeedbackLines } from "./answer-feedback-lines.js";

const postponed = [
  "later", "später", "más tarde", "plus tard", "più tardi", "mais tarde", "senere",
  "później", "позже", "sonra", "nanti", "mamaya",
];

const hype = ["amazing", "incredible", "awesome", "perfect", "!!"];

describe("calm check clips", () => {
  it("gives every native language warm praise, two close lines, and one unclear line", () => {
    expect(Object.keys(answerFeedbackLines).sort()).toEqual([...languageIds].sort());
    for (const id of languageIds) {
      const lines = answerFeedbackLines[id];
      const all = [...lines.recalled, ...lines.close, lines.unclear];
      expect(lines.recalled).toHaveLength(2);
      expect(all).toHaveLength(5);
      for (const text of all) {
        expect(text.trim().length).toBeGreaterThan(1);
        expect(text.length).toBeLessThan(80);
        const folded = text.toLocaleLowerCase();
        for (const word of postponed) expect(folded).not.toContain(word);
        for (const word of hype) expect(folded).not.toContain(word);
      }
    }
  });

  it("uses the calm English wording", () => {
    expect(answerFeedbackLines["en-US"]).toEqual({
      recalled: ["Yes, you got it.", "Well done."],
      close: ["Close.", "Nearly."],
      unclear: "I didn’t quite catch that.",
    });
  });
});
