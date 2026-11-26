import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import type { LessonType } from "@resolingo/shared";
import { logger } from "firebase-functions";
import { ARTWORK_LOCATION, ARTWORK_MODEL, DEFAULT_ARTWORK_LOCATION, DEFAULT_ARTWORK_MODEL } from "./config.js";
import { bucket } from "./firebase.js";
import { vertexProjectId } from "./gemini.js";

/**
 * One fixed house style so every lesson's artwork looks like part of the same set.
 * Bump STYLE_VERSION when this changes, so cached images from the old style are not reused.
 */
export const STYLE_VERSION = "v1";
export const ARTWORK_STYLE = [
  "Flat vector illustration in a calm, friendly editorial style.",
  "Limited palette: deep teal #0F9D8A, mint #66E0C2, warm amber #FFC857, soft coral #FF775F and navy #08152F on a warm off-white #F8F7F3 background.",
  "Simple rounded geometric shapes, soft even lighting, subtle paper grain, no gradients, no outlines, no photorealism.",
  "Centered square composition with generous empty space around the subject.",
  "Two or three small empty speech bubbles float near the scene to suggest people talking and learning a language.",
  "Absolutely no text, letters, numbers, words, signs with writing, logos or flags.",
].join(" ");

const SCENE_HINT: Record<LessonType, string> = {
  conversation: "A small everyday scene where people talk about",
  grammar: "A tidy desk scene with a notebook, index cards and a cup, themed around",
  phrase: "A single friendly moment that captures the phrase",
};

/**
 * The prompt names the topic only, not the language, so the model does not reach for
 * flags or written words, and the same topic reuses one cached image across languages.
 */
export function artworkPrompt(input: { type: LessonType; topic: string }): string {
  const topic = input.topic.replace(/\s+/g, " ").trim().slice(0, 160);
  return `${SCENE_HINT[input.type]} "${topic}". ${ARTWORK_STYLE}`;
}

export function artworkCachePath(model: string, prompt: string): string {
  const key = createHash("sha256").update(`${STYLE_VERSION}\n${model}\n${prompt.toLowerCase()}`).digest("hex");
  return `cache/artwork/${key}.jpg`;
}

export function artworkPath(uid: string, lessonId: string): string {
  return `users/${uid}/lessons/${lessonId}/artwork.jpg`;
}

export type ArtworkPart = {
  inlineData?: { data?: string; mimeType?: string };
};

export type ArtworkResponse = {
  candidates?: {
    finishReason?: string;
    content?: { parts?: ArtworkPart[] };
  }[];
};

export type ArtworkClient = {
  generateContent(request: {
    model: string;
    contents: string;
    config: Record<string, unknown>;
  }): Promise<ArtworkResponse>;
};

function configured(value: string, fallback: string): string {
  return value.trim() || fallback;
}

let defaultClient: ArtworkClient | undefined;
function vertexArtworkClient(): ArtworkClient {
  if (defaultClient) return defaultClient;
  const ai = new GoogleGenAI({
    vertexai: true,
    project: vertexProjectId(),
    location: configured(ARTWORK_LOCATION.value(), DEFAULT_ARTWORK_LOCATION),
  });
  defaultClient = { generateContent: (request) => ai.models.generateContent(request) };
  return defaultClient;
}

function firstInlineImage(response: ArtworkResponse): { bytes?: string; mimeType?: string; reason?: string } {
  const candidate = response.candidates?.[0];
  for (const part of candidate?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      const image: { bytes: string; mimeType?: string } = { bytes: part.inlineData.data };
      if (part.inlineData.mimeType) image.mimeType = part.inlineData.mimeType;
      return image;
    }
  }
  return candidate?.finishReason ? { reason: candidate.finishReason } : {};
}

/**
 * Makes the lesson's artwork and returns its Storage path, or undefined.
 * Artwork is decoration: any failure is logged and the lesson ships without it.
 * One image per lesson, 512px JPEG; identical prompts reuse the cached image for free.
 */
export async function createLessonArtwork(
  input: { uid: string; lessonId: string; type: LessonType; topic: string },
  client?: ArtworkClient,
): Promise<string | undefined> {
  const model = configured(ARTWORK_MODEL.value(), DEFAULT_ARTWORK_MODEL);
  if (model.toLowerCase() === "off" || !input.topic.trim()) return undefined;
  const prompt = artworkPrompt(input);
  const cachePath = artworkCachePath(model, prompt);
  const destination = artworkPath(input.uid, input.lessonId);
  try {
    const [cached] = await bucket.file(cachePath).exists();
    if (!cached) {
      const response = await (client ?? vertexArtworkClient()).generateContent({
        model,
        contents: prompt,
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "512",
          },
        },
      });
      const image = firstInlineImage(response);
      if (!image.bytes) {
        logger.warn("lesson_artwork_empty", { lessonId: input.lessonId, reason: image.reason });
        return undefined;
      }
      const contentType = image.mimeType?.startsWith("image/") ? image.mimeType : "image/jpeg";
      await bucket.file(cachePath).save(Buffer.from(image.bytes, "base64"), {
        resumable: false,
        contentType,
        metadata: { cacheControl: "private,max-age=31536000,immutable" },
      });
    }
    await bucket.file(cachePath).copy(bucket.file(destination));
    logger.info("lesson_artwork_ready", { lessonId: input.lessonId, cached });
    return destination;
  } catch (error) {
    logger.warn("lesson_artwork_failed", {
      lessonId: input.lessonId,
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
    return undefined;
  }
}
