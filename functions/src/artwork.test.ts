import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, Buffer>();
vi.mock("./firebase.js", () => ({
  bucket: {
    file: (path: string) => ({
      exists: async () => [files.has(path)],
      save: async (bytes: Buffer) => { files.set(path, bytes); },
      copy: async (target: { path: string }) => { files.set(target.path, files.get(path)!); },
      path,
    }),
  },
}));
let model = "gemini-3.1-flash-image";
vi.mock("./config.js", () => ({
  ARTWORK_MODEL: { value: () => model },
  ARTWORK_LOCATION: { value: () => "" },
  DEFAULT_ARTWORK_MODEL: "gemini-3.1-flash-image",
  DEFAULT_ARTWORK_LOCATION: "global",
}));
vi.mock("./gemini.js", () => ({ vertexProjectId: () => "test" }));
vi.mock("firebase-functions", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const { artworkPrompt, createLessonArtwork, ARTWORK_STYLE } = await import("./artwork.js");

const input = { uid: "alice", lessonId: "lesson-1", type: "conversation" as const, topic: "Ordering coffee at a café" };
const image = {
  candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from("jpeg").toString("base64"), mimeType: "image/jpeg" } }] } }],
};

describe("lesson artwork", () => {
  beforeEach(() => {
    files.clear();
    model = "gemini-3.1-flash-image";
  });

  it("uses the same house style for every lesson and forbids written text", () => {
    const a = artworkPrompt({ type: "conversation", topic: "Ordering coffee" });
    const b = artworkPrompt({ type: "grammar", topic: "Past tense with haben" });
    expect(a.endsWith(ARTWORK_STYLE)).toBe(true);
    expect(b.endsWith(ARTWORK_STYLE)).toBe(true);
    expect(ARTWORK_STYLE).toMatch(/no text, letters/);
  });

  it("asks for one 512px image and stores it under the lesson", async () => {
    const generateContent = vi.fn().mockResolvedValue(image);
    const path = await createLessonArtwork(input, { generateContent });
    expect(path).toBe("users/alice/lessons/lesson-1/artwork.jpg");
    expect(files.get(path!)?.toString()).toBe("jpeg");
    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent.mock.calls[0]![0].config).toMatchObject({
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "1:1", imageSize: "512" },
    });
  });

  it("reuses the cached image for the same topic instead of paying again", async () => {
    const generateContent = vi.fn().mockResolvedValue(image);
    await createLessonArtwork(input, { generateContent });
    const path = await createLessonArtwork({ ...input, uid: "bob", lessonId: "lesson-9" }, { generateContent });
    expect(path).toBe("users/bob/lessons/lesson-9/artwork.jpg");
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it("never fails the lesson when the model errors or filters the image", async () => {
    await expect(createLessonArtwork(input, { generateContent: vi.fn().mockRejectedValue(new Error("quota")) })).resolves.toBeUndefined();
    await expect(createLessonArtwork(input, { generateContent: vi.fn().mockResolvedValue({ candidates: [{ finishReason: "SAFETY" }] }) })).resolves.toBeUndefined();
  });

  it("can be switched off without a deploy of new code", async () => {
    model = "off";
    const generateContent = vi.fn();
    await expect(createLessonArtwork(input, { generateContent })).resolves.toBeUndefined();
    expect(generateContent).not.toHaveBeenCalled();
  });
});
