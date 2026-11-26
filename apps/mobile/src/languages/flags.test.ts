import { describe, expect, it } from "vitest";
import { languageIds } from "@resolingo/shared";
import { languageFlag, languageLabel } from "./flags";

describe("languageFlag", () => {
  it("builds the regional flag from the language id", () => {
    expect(languageFlag("de-DE")).toBe("🇩🇪");
    expect(languageFlag("en-GB")).toBe("🇬🇧");
    expect(languageFlag("pt-BR")).toBe("🇧🇷");
    expect(languageFlag("fil-PH")).toBe("🇵🇭");
  });

  it("gives every supported language a flag", () => {
    for (const id of languageIds) expect([...languageFlag(id)]).toHaveLength(2);
  });

  it("labels languages", () => {
    expect(languageLabel("es-MX")).toBe("Spanish (Mexico)");
  });
});
