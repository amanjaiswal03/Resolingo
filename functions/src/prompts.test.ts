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
    expect(prompt).toContain("delivery");
    expect(prompt).toContain("clear");
    expect(prompt).toContain("[[lang:de-DE]]");
    expect(prompt).toContain("[[lang:en-US]]");
    expect(prompt).toContain("7–10 minute");
    expect(prompt).toContain("18 to 30");
    expect(prompt).toContain("at least eight vocabulary");
    expect(prompt).toContain("at least six listen-and-repeat");
    expect(prompt).toContain("short recap of two or three segments");
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
    expect(prompt).toContain("at least twelve dialogue");
    expect(prompt).toContain("at least four listen-and-repeat");
  });
});
