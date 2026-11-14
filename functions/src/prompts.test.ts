import { describe, expect, it } from "vitest";
import { languageById } from "@resolingo/shared";
import { lessonPrompt } from "./prompts.js";

describe("lesson prompts", () => {
  it("adapts the level, exact language IDs, and recent topics", () => {
    const prompt = lessonPrompt({
      type: "grammar",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "B2",
      recentTopics: ["Ordering at a bakery"],
    });
    expect(prompt).toContain("B2 learner");
    expect(prompt).toContain("teaching=en-US, target=de-DE");
    expect(prompt).toContain("Ordering at a bakery");
    expect(prompt).toContain("listen-and-repeat drills");
    expect(prompt).toContain("one item for every line");
    expect(prompt).toContain("speak is 6 to 8");
    expect(prompt).toContain("{translation}");
    expect(prompt).toContain("Do not gloss every word");
    expect(prompt).toContain("der Bahnhof");
    expect(prompt).toContain("that chunk alone");
    expect(prompt).toContain("means");
    expect(prompt).toContain("[[lang:de-DE]]");
    expect(prompt).toContain("[[lang:en-US]]");
  });

  it("requires transliteration for configured writing systems", () => {
    const prompt = lessonPrompt({
      type: "conversation",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["ja-JP"],
      level: "A1",
      recentTopics: [],
    });
    expect(prompt).toContain("Latin-script transliteration");
  });
});
