import { describe, expect, it } from "vitest";
import { quotesStayTrue } from "./quotes.js";

describe("quotesStayTrue", () => {
  it("accepts a note that quotes words really in the source", () => {
    expect(quotesStayTrue("Here [[lang:de-DE]]möchte[[/lang]] softens the ask.", ["Ich möchte einen Kaffee."], "de-DE")).toBe(true);
    expect(quotesStayTrue("No quote at all.", [], "de-DE")).toBe(true);
  });

  it("rejects a quote that is missing, altered or only part of a word", () => {
    expect(quotesStayTrue("Remember [[lang:de-DE]]Ich hätte gern[[/lang]]?", ["Ich möchte einen Kaffee."], "de-DE")).toBe(false);
    expect(quotesStayTrue("[[lang:de-DE]]Kaff[[/lang]]", ["Ich möchte einen Kaffee."], "de-DE")).toBe(false);
  });

  it("matches inside unspaced scripts", () => {
    expect(quotesStayTrue("[[lang:ja-JP]]ください[[/lang]]", ["コーヒーをください。"], "ja-JP")).toBe(true);
    expect(quotesStayTrue("[[lang:ja-JP]]お願いします[[/lang]]", ["コーヒーをください。"], "ja-JP")).toBe(false);
  });
});
