import { describe, expect, it } from "vitest";
import { selectVoices, voiceTierFromEnv } from "./voices.js";

const inventory = [
  "en-US-Chirp3-HD-Aoede",
  "en-US-Neural2-A",
  "en-US-Neural2-D",
  "en-US-Wavenet-A",
  "en-US-Wavenet-B",
  "en-US-Standard-C",
  "en-US-Standard-D",
];

describe("voice tier selection", () => {
  it("defaults to WaveNet and ignores Chirp3 and Neural2", () => {
    expect(voiceTierFromEnv(undefined)).toBe("wavenet");
    expect(voiceTierFromEnv("  ")).toBe("wavenet");
    const selected = selectVoices(inventory, "wavenet");
    expect(selected).toEqual({ tier: "wavenet", voices: ["en-US-Wavenet-A", "en-US-Wavenet-B"] });
  });

  it("falls back to Standard when fewer than two WaveNet voices exist", () => {
    const selected = selectVoices(["en-US-Wavenet-A", "en-US-Standard-C", "en-US-Standard-D", "en-US-Chirp3-HD-Aoede"], "wavenet");
    expect(selected.tier).toBe("standard");
    expect(selected.voices).toEqual(["en-US-Standard-C", "en-US-Standard-D"]);
  });

  it("keeps a single WaveNet voice when Standard is also missing", () => {
    expect(selectVoices(["en-US-Wavenet-A", "en-US-Neural2-A"], "wavenet")).toEqual({
      tier: "wavenet",
      voices: ["en-US-Wavenet-A"],
    });
  });

  it("does not upgrade a Standard configuration to a paid neural voice", () => {
    expect(selectVoices(inventory, "standard").voices).toEqual(["en-US-Standard-C", "en-US-Standard-D"]);
  });

  it("uses Chirp3 only when that tier is requested and has two voices", () => {
    const selected = selectVoices([...inventory, "en-US-Chirp3-HD-Puck"], "chirp3");
    expect(selected.tier).toBe("chirp3");
    expect(selected.voices).toEqual(["en-US-Chirp3-HD-Aoede", "en-US-Chirp3-HD-Puck"]);
  });

  it("rejects an unknown tier", () => {
    expect(() => voiceTierFromEnv("studio")).toThrow("TTS_VOICE_TIER_INVALID:studio");
  });
});
