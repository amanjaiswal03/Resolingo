import { describe, expect, it } from "vitest";
import { applyTargetVoices, displayLessonSegment, lessonDisplayText, markupIssues, repairMarkup, speechSpans } from "./markup.js";

describe("pronunciation markup", () => {
  it("shows the line without tags", () => {
    expect(lessonDisplayText("Say [[lang:de-DE]]Guten Tag[[/lang]] please.")).toBe("Say Guten Tag please.");
    expect(lessonDisplayText("Hello [/lang] [[/de]] [[de]] there")).toBe("Hello there");
    expect(lessonDisplayText("Anna[/lang]!")).toBe("Anna!");
    expect(speechSpans("Say [/lang] please.", "en-US")).toEqual([{ language: "en-US", text: "Say please." }]);
    expect(displayLessonSegment({
      text: "Say [[lang:de-DE]]Guten Tag[[/lang]] [/lang]",
      translation: "[[de]]hello[[/de]]",
    })).toEqual({ text: "Say Guten Tag", translation: "hello" });
  });

  it("keeps a target phrase inside a teaching-language line in the target language", () => {
    expect(speechSpans("Say [[lang:de-DE]]Guten Tag[[/lang]] please.", "en-US")).toEqual([
      { language: "en-US", text: "Say " },
      { language: "de-DE", text: "Guten Tag" },
      { language: "en-US", text: " please." },
    ]);
  });

  it("keeps a native phrase inside a target-language line in the teaching language", () => {
    expect(speechSpans("Das heißt [[lang:en-US]]please[[/lang]].", "de-DE")).toEqual([
      { language: "de-DE", text: "Das heißt " },
      { language: "en-US", text: "please." },
    ]);
  });

  it("leaves an unmarked line as one span", () => {
    expect(speechSpans("Hello there.", "en-US")).toEqual([{ language: "en-US", text: "Hello there." }]);
  });

  it("tags a single Japanese word and a quoted Japanese line", () => {
    const { segments } = applyTargetVoices([
      { language: "ja-JP", text: "駅" },
      { language: "en-US", text: "The word 駅 is a station." },
      { language: "en-US", text: "Say 「駅はどこですか」 here." },
      { language: "en-US", text: "The French line is «gare»." },
      { language: "en-US", text: "German quotes look like „Bahnhof“." },
    ], "en-US", "ja-JP");
    expect(speechSpans(segments[1]!.text, "en-US")).toEqual([
      { language: "en-US", text: "The word " },
      { language: "ja-JP", text: "駅" },
      { language: "en-US", text: " is a station." },
    ]);
    expect(segments[2]!.text).toContain("[[lang:ja-JP]]駅はどこですか[[/lang]]");
    expect(segments[3]!.text).toContain("[[lang:ja-JP]]gare[[/lang]]");
    expect(segments[4]!.text).toContain("[[lang:ja-JP]]Bahnhof[[/lang]]");
  });

  it("keeps an accented teaching-language translation in its own language", () => {
    const { segments } = applyTargetVoices([
      { language: "de-DE", text: "müde", translation: "fatigué" },
      { language: "fr-FR", text: 'Cela signifie "fatigué".' },
    ], "fr-FR", "de-DE");
    expect(speechSpans(segments[1]!.text, "fr-FR")).toEqual([{ language: "fr-FR", text: 'Cela signifie "fatigué".' }]);
  });

  it("rejects nested, empty, unknown, and unclosed tags", () => {
    expect(markupIssues("Say [[lang:de-DE]]Guten Tag[[/lang]].")).toEqual([]);
    expect(markupIssues("[[lang:de-DE]][[lang:en-US]]hi[[/lang]][[/lang]]")).toContain("nested");
    expect(markupIssues("[[lang:de-DE]][[/lang]]")).toContain("empty");
    expect(markupIssues("[[lang:xx-YY]]hi[[/lang]]")).toContain("unknown:xx-YY");
    expect(markupIssues("[[lang:de-DE]]hi")).toContain("unclosed");
    expect(markupIssues("hi[[/lang]]")).toContain("unexpected-close");
  });

  it("closes an unfinished language span and drops tags that cannot be spoken", () => {
    expect(repairMarkup("Say [[lang:de-DE]]Guten Tag")).toBe("Say [[lang:de-DE]]Guten Tag[[/lang]]");
    expect(markupIssues(repairMarkup("Say [[lang:de-DE]]Guten Tag"))).toEqual([]);
    expect(repairMarkup("[[lang:xx-YY]]hi[[/lang]]")).toBe("hi");
    expect(repairMarkup("hi[[/lang]]")).toBe("hi");
    expect(speechSpans(repairMarkup("Say [[lang:de-DE]]Guten Tag"), "en-US")[1]).toEqual({ language: "de-DE", text: "Guten Tag" });
  });
});
