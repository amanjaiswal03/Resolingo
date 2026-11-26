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
let model = "imagen-4.0-fast-generate-001";
vi.mock("./config.js", () => ({
  ARTWORK_MODEL: { value: () => model },
  ARTWORK_LOCATION: { value: () => "" },
  DEFAULT_ARTWORK_MODEL: "imagen-4.0-fast-generate-001",
  DEFAULT_ARTWORK_LOCATION: "europe-west1",
}));
vi.mock("./gemini.js", () => ({ vertexProjectId: () => "test" }));
vi.mock("firebase-functions", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const { artworkPrompt, createLessonArtwork, ARTWORK_STYLE } = await import("./artwork.js");

const input = { uid: "alice", lessonId: "lesson-1", type: "conversation" as const, topic: "Ordering coffee at a café" };
const image = { generatedImages: [{ image: { imageBytes: Buffer.from("jpeg").toString("base64") } }] };

describe("lesson artwork", () => {
  beforeEach(() => {
    files.clear();
    model = "imagen-4.0-fast-generate-001";
  });

  it("uses the same house style for every lesson and forbids written text", () => {
    const a = artworkPrompt({ type: "conversation", topic: "Ordering coffee" });
    const b = artworkPrompt({ type: "grammar", topic: "Past tense with haben" });
    expect(a.endsWith(ARTWORK_STYLE)).toBe(true);
    expect(b.endsWith(ARTWORK_STYLE)).toBe(true);
    expect(ARTWORK_STYLE).toMatch(/no text, letters/);
  });

  it("asks for one small JPEG and stores it under the lesson", async () => {
    const generateImages = vi.fn().mockResolvedValue(image);
    const path = await createLessonArtwork(input, { generateImages });
    expect(path).toBe("users/alice/lessons/lesson-1/artwork.jpg");
    expect(files.get(path!)?.toString()).toBe("jpeg");
    expect(generateImages).toHaveBeenCalledOnce();
    expect(generateImages.mock.calls[0]![0].config).toMatchObject({ numberOfImages: 1, outputMimeType: "image/jpeg" });
  });

  it("reuses the cached image for the same topic instead of paying again", async () => {
    const generateImages = vi.fn().mockResolvedValue(image);
    await createLessonArtwork(input, { generateImages });
    const path = await createLessonArtwork({ ...input, uid: "bob", lessonId: "lesson-9" }, { generateImages });
    expect(path).toBe("users/bob/lessons/lesson-9/artwork.jpg");
    expect(generateImages).toHaveBeenCalledOnce();
  });

  it("never fails the lesson when the model errors or filters the image", async () => {
    await expect(createLessonArtwork(input, { generateImages: vi.fn().mockRejectedValue(new Error("quota")) })).resolves.toBeUndefined();
    await expect(createLessonArtwork(input, { generateImages: vi.fn().mockResolvedValue({ generatedImages: [{ raiFilteredReason: "filtered" }] }) })).resolves.toBeUndefined();
  });

  it("can be switched off without a deploy of new code", async () => {
    model = "off";
    const generateImages = vi.fn();
    await expect(createLessonArtwork(input, { generateImages })).resolves.toBeUndefined();
    expect(generateImages).not.toHaveBeenCalled();
  });
});
