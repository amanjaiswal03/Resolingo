import { describe, expect, it } from "vitest";
import { lessonDisplayText, markupIssues, repairMarkup, speechSpans } from "./markup.js";

describe("pronunciation markup", () => {
  it("shows the line without tags", () => {
    expect(lessonDisplayText("Say [[lang:de-DE]]Guten Tag[[/lang]] please.")).toBe("Say Guten Tag please.");
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
