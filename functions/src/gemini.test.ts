import { FinishReason, HarmBlockThreshold, HarmCategory } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { generateLessonContent, lessonGenerationConfig, type LessonModelClient } from "./gemini.js";

function lesson(topic: string) {
  return {
    title: "Coffee shop greetings",
    topic,
    summary: "Practice a short cafe greeting and order.",
    segments: Array.from({ length: 8 }, (_, index) => ({
      id: `s${index + 1}`,
      kind: index === 7 ? "recap" : "dialogue",
      speaker: index % 2 === 0 ? "speakerA" : "speakerB",
      language: index % 2 === 0 ? "de-DE" : "en-US",
      text: `Line ${index + 1} of the cafe lesson.`,
    })),
  };
}

function client(responses: Array<{ text?: string; blocked?: boolean }>): LessonModelClient & { contents: string[] } {
  const contents: string[] = [];
  return {
    contents,
    generateContent: vi.fn(async (request) => {
      contents.push(request.contents);
      const next = responses[contents.length - 1] ?? { text: "" };
      if (next.blocked) {
        return { text: undefined, candidates: [{ finishReason: FinishReason.SAFETY }] };
      }
      return { text: next.text ?? "", candidates: [{ finishReason: FinishReason.STOP }] };
    }),
  };
}

const input = {
  type: "conversation" as const,
  nativeLanguage: "en-US" as const,
  targetLanguage: "de-DE" as const,
  level: "A1" as const,
  recentTopics: ["Ordering coffee"],
};

describe("Gemini lesson generation", () => {
  it("asks Vertex for structured JSON with medium safety filters", () => {
    const config = lessonGenerationConfig();
    expect(config.responseMimeType).toBe("application/json");
    expect(config.safetySettings).toEqual([
      HarmCategory.HARM_CATEGORY_HARASSMENT,
      HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    ].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE })));
    expect(JSON.stringify(config.responseJsonSchema)).toContain("de-DE");
  });

  it("returns the first schema-valid lesson and does not send the user id", async () => {
    const model = client([{ text: JSON.stringify(lesson("Buying a train ticket")) }]);
    const result = await generateLessonContent(input, model);
    expect(result.topic).toBe("Buying a train ticket");
    expect(model.contents).toHaveLength(1);
    expect(model.contents[0]).toContain("teaching=en-US, target=de-DE");
    expect(model.contents[0]).toContain("learner of German");
    expect(model.contents[0]).not.toMatch(/users\/|firebase uid/i);
    expect(model.generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-3.5-flash-lite",
      config: expect.objectContaining({ responseMimeType: "application/json" }),
    }));
  });

  it("repairs one malformed response, then accepts the next lesson", async () => {
    const model = client([
      { text: "not json" },
      { text: JSON.stringify(lesson("Asking for directions")) },
    ]);
    const result = await generateLessonContent(input, model);
    expect(result.topic).toBe("Asking for directions");
    expect(model.contents[1]).toContain("REPAIR");
  });

  it("rejects a repeated topic and keeps the repaired lesson", async () => {
    const model = client([
      { text: JSON.stringify(lesson("ordering coffee")) },
      { text: JSON.stringify(lesson("Lost luggage")) },
    ]);
    await expect(generateLessonContent(input, model)).resolves.toMatchObject({ topic: "Lost luggage" });
  });

  it("retries once after a safety block", async () => {
    const model = client([
      { blocked: true },
      { text: JSON.stringify(lesson("Weekend market")) },
    ]);
    await expect(generateLessonContent(input, model)).resolves.toMatchObject({ topic: "Weekend market" });
  });

  it("fails closed when both attempts are blocked or invalid", async () => {
    await expect(generateLessonContent(input, client([{ blocked: true }, { blocked: true }]))).rejects.toThrow("MODEL_OUTPUT_BLOCKED");
    await expect(generateLessonContent(input, client([{ text: "{}" }, { text: "nope" }]))).rejects.toThrow("MODEL_OUTPUT_INVALID");
  });
});
