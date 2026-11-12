import { describe, expect, it } from "vitest";
import { DEFAULT_SPEAKER_NAMES, dialogueText, normalizeSpeakerNames, speakerLabel } from "./speakers.js";

describe("speaker names", () => {
  it("keeps a masculine and a feminine name and fills anything missing", () => {
    expect(normalizeSpeakerNames({ speakerA: "Hans", speakerB: "Greta" })).toEqual({
      teacher: "Mira",
      speakerA: "Hans",
      speakerB: "Greta",
    });
    expect(normalizeSpeakerNames(undefined)).toEqual(DEFAULT_SPEAKER_NAMES);
  });

  it("replaces blank, multi-word, and duplicate names", () => {
    expect(normalizeSpeakerNames({ teacher: "  ", speakerA: "Mary Ann", speakerB: "Lukas" })).toEqual({
      teacher: "Mira",
      speakerA: "Lukas",
      speakerB: "Anna",
    });
    expect(normalizeSpeakerNames({ teacher: "Lukas", speakerA: "Lukas", speakerB: "Lukas" })).toEqual({
      teacher: "Mira",
      speakerA: "Lukas",
      speakerB: "Anna",
    });
  });

  it("uses the same alias in the line and on the screen", () => {
    const names = normalizeSpeakerNames({ speakerA: "Lukas", speakerB: "Anna" });
    expect(dialogueText("Speaker A asks SpeakerB to repeat.", names)).toBe("Lukas asks Anna to repeat.");
    expect(speakerLabel("speakerA", names)).toBe("Lukas");
    expect(speakerLabel("teacher", names)).toBe("Mira");
  });
});
