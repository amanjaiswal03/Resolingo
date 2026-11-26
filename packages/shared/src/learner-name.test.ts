import { describe, expect, it } from "vitest";
import { learnerFirstName, learnerGreeting, personalizeSegments, stripLearnerPlaceholder } from "./learner-name.js";

type Seg = { id: string; speaker: string; language: string; text: string; phase?: string; translation?: string };
const teacher = (id: number, phase: string, text: string, language = "en-US"): Seg => ({ id: `s${id}`, speaker: "teacher", language, phase, text });
const dialogue = (id: number, text: string, translation?: string): Seg => ({
  id: `s${id}`, speaker: "speakerA", language: "de-DE", phase: "dialogue", text, ...(translation ? { translation } : {}),
});

describe("learnerFirstName", () => {
  it("uses the first word of the nickname", () => {
    expect(learnerFirstName({ nickname: "  Mukesh Jaiswal " })).toBe("Mukesh");
    expect(learnerFirstName({ nickname: "Anne-Marie" })).toBe("Anne-Marie");
    expect(learnerFirstName({ nickname: "O’Neil" })).toBe("O’Neil");
    expect(learnerFirstName({ nickname: "さくら" })).toBe("さくら");
  });

  it("falls back to the display name, then to nothing", () => {
    expect(learnerFirstName({ nickname: "", displayName: "Ada Lovelace" })).toBe("Ada");
    expect(learnerFirstName({ nickname: "1234 🙂" })).toBeUndefined();
    expect(learnerFirstName({})).toBeUndefined();
    expect(learnerFirstName(undefined)).toBeUndefined();
  });

  it("drops characters that could break the line or the prompt", () => {
    expect(learnerFirstName({ nickname: "Ada{learner}" })).toBe("Adalearner");
    expect(learnerFirstName({ nickname: "[[lang:de]]Max" })).toBe("langdeMax");
    expect(learnerFirstName({ nickname: "x".repeat(30) })).toBeUndefined();
  });
});

describe("stripLearnerPlaceholder", () => {
  it("keeps the line natural when there is no name", () => {
    expect(stripLearnerPlaceholder("Welcome, {learner}! Today you order a coffee.")).toBe("Welcome! Today you order a coffee.");
    expect(stripLearnerPlaceholder("{learner}, let's begin.")).toBe("Let's begin.");
    expect(stripLearnerPlaceholder("Nice work today, {learner}.")).toBe("Nice work today.");
    expect(stripLearnerPlaceholder("Welcome, {learner}, to today's lesson.")).toBe("Welcome to today's lesson.");
    expect(stripLearnerPlaceholder("こんにちは、{learner}さん。今日はカフェです。")).toBe("こんにちは。今日はカフェです。");
    expect(stripLearnerPlaceholder("مرحبًا يا {learner}. لنبدأ.")).toBe("مرحبًا. لنبدأ.");
    expect(stripLearnerPlaceholder("No name here.")).toBe("No name here.");
  });
});

describe("personalizeSegments", () => {
  it("uses the name in the opening and the closing only", () => {
    const segments = [
      teacher(1, "intro", "Hi {learner}, today you order a coffee."),
      dialogue(2, "Einen Kaffee, bitte.", "A coffee, please."),
      teacher(3, "breakdown", "Good, {learner}. Listen again."),
      teacher(4, "closing", "Nice work, {learner}. Use this at a café."),
    ];
    const result = personalizeSegments(segments, "Mukesh", "en-US");
    expect(result.map((item) => item.text)).toEqual([
      "Hi Mukesh, today you order a coffee.",
      "Einen Kaffee, bitte.",
      "Good. Listen again.",
      "Nice work, Mukesh. Use this at a café.",
    ]);
  });

  it("never puts the name in a dialogue line or its translation", () => {
    const segments = [teacher(1, "intro", "Welcome, {learner}."), dialogue(2, "Hallo {learner}!", "Hello {learner}!")];
    const result = personalizeSegments(segments, "Mukesh", "en-US");
    expect(result[1]).toMatchObject({ text: "Hallo!", translation: "Hello!" });
  });

  it("greets the learner when the model did not", () => {
    const segments = [teacher(1, "intro", "Today: how to order a coffee."), teacher(2, "closing", "That's it.")];
    expect(personalizeSegments(segments, "Mukesh", "en-US")[0]!.text).toBe("Hi Mukesh. Today: how to order a coffee.");
    const german = [teacher(1, "intro", "Heute bestellen wir Kaffee.", "de-DE")];
    expect(personalizeSegments(german, "Mukesh", "de-DE")[0]!.text).toBe("Hallo Mukesh. Heute bestellen wir Kaffee.");
  });

  it("adds nothing and removes every placeholder without a name", () => {
    const segments = [teacher(1, "intro", "Hi {learner}, today you order a coffee."), teacher(2, "closing", "See you, {learner}.")];
    expect(personalizeSegments(segments, undefined, "en-US").map((item) => item.text)).toEqual([
      "Hi, today you order a coffee.",
      "See you.",
    ]);
  });

  it("fills only one placeholder per line and drops a line that was only the name", () => {
    const segments = [teacher(1, "intro", "{learner}, hi {learner}."), teacher(2, "listen", "{learner}."), teacher(3, "closing", "Bye.")];
    const result = personalizeSegments(segments, "Ada", "en-US");
    expect(result.map((item) => item.text)).toEqual(["Ada, hi.", "Bye."]);
  });

  it("has a greeting for every teaching language", () => {
    expect(learnerGreeting("en-GB")).toBe("Hi {learner}.");
    expect(learnerGreeting("fr-CA")).toBe("Bonjour {learner}.");
    expect(learnerGreeting("ja-JP")).toContain("{learner}");
  });
});
