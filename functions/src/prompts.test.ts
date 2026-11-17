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
    expect(prompt).toContain("One teacher");
    expect(prompt).toContain("no second speaker");
    expect(prompt).toContain("at least 12");
    expect(prompt).toContain("you, to a friend");
    expect(prompt).toContain("at most twice");
    expect(prompt).toContain("der Bahnhof");
    expect(prompt).toContain("means");
    expect(prompt).toContain("[[lang:de-DE]]");
    expect(prompt).toContain("[[lang:en-US]]");
    expect(prompt).not.toContain("listen-and-repeat drills");
  });

  it("keeps conversation lessons as a two-speaker dialogue", () => {
    const prompt = lessonPrompt({
      type: "conversation",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "A2",
      recentTopics: [],
    });
    expect(prompt).toContain("one item for every line");
    expect(prompt).toContain("speak is 6 to 8");
    expect(prompt).toContain("realistic conversation");
  });

  it("keeps a phrase lesson on the learner's sentence", () => {
    const prompt = lessonPrompt({
      type: "phrase",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "A2",
      recentTopics: [],
      phrase: {
        nativeText: "I need to buy a pair of shoes",
        translation: "Ich muss ein Paar Schuhe kaufen.",
        alternatives: [{ label: "formally", text: "Ich hätte gern ein Paar Schuhe." }],
        note: "Literally, that is cats and dogs.",
      },
    });
    expect(prompt).toContain("Ich muss ein Paar Schuhe kaufen.");
    expect(prompt).toContain("not a copy");
    expect(prompt).toContain("German möchte");
    expect(prompt).toContain("glossed on its own");
    expect(prompt).toContain("Do not turn that literal wording into an answer");
    expect(prompt).toContain("formally");
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
