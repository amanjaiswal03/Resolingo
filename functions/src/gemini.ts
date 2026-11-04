import {
  FinishReason,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from "@google/genai";
import {
  GeneratedLessonSchema,
  languageById,
  languageIds,
  type CefrLevel,
  type GeneratedLesson,
  type LanguageId,
  type LessonType,
} from "@resolingo/shared";
import { DEFAULT_GEMINI_LESSON_MODEL, DEFAULT_GEMINI_LOCATION, GEMINI_LESSON_MODEL, GEMINI_LOCATION } from "./config.js";
import { lessonPrompt } from "./prompts.js";

const SYSTEM_INSTRUCTION = "You are Resolingo's expert multilingual lesson designer. Return only the requested validated lesson.";

const SAFETY_CATEGORIES = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
] as const;

export function lessonResponseJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["title", "topic", "summary", "segments"],
    properties: {
      title: { type: "string" },
      topic: { type: "string" },
      summary: { type: "string" },
      segments: {
        type: "array",
        minItems: 8,
        maxItems: 40,
        items: {
          type: "object",
          required: ["id", "kind", "speaker", "language", "text"],
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["narration", "dialogue", "explanation", "example", "drill", "recap"] },
            speaker: { type: "string", enum: ["teacher", "speakerA", "speakerB"] },
            language: { type: "string", enum: [...languageIds] },
            text: { type: "string" },
            translation: { type: "string" },
            transliteration: { type: "string" },
          },
        },
      },
    },
  };
}

export function lessonGenerationConfig(): GenerateContentConfig {
  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    responseMimeType: "application/json",
    responseJsonSchema: lessonResponseJsonSchema(),
    safetySettings: SAFETY_CATEGORIES.map((category) => ({
      category,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    })),
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
  };
}

export type LessonModelClient = {
  generateContent(request: {
    model: string;
    contents: string;
    config: GenerateContentConfig;
  }): Promise<Pick<GenerateContentResponse, "text" | "promptFeedback" | "candidates">>;
};

function configured(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function vertexProjectId(): string {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "resolingo";
}

export function geminiModel(): string {
  return configured(GEMINI_LESSON_MODEL.value(), DEFAULT_GEMINI_LESSON_MODEL);
}

export function geminiLocation(): string {
  return configured(GEMINI_LOCATION.value(), DEFAULT_GEMINI_LOCATION);
}

export function createVertexLessonClient(client?: LessonModelClient): LessonModelClient {
  if (client) return client;
  const ai = new GoogleGenAI({
    vertexai: true,
    project: vertexProjectId(),
    location: geminiLocation(),
  });
  return {
    generateContent: (request) => ai.models.generateContent(request),
  };
}

function blocked(response: Pick<GenerateContentResponse, "promptFeedback" | "candidates">): boolean {
  if (response.promptFeedback?.blockReason) return true;
  return response.candidates?.[0]?.finishReason === FinishReason.SAFETY;
}

export async function generateLessonContent(
  input: {
    type: LessonType;
    nativeLanguage: LanguageId;
    targetLanguage: LanguageId;
    level: CefrLevel;
    recentTopics: string[];
  },
  client?: LessonModelClient,
): Promise<GeneratedLesson> {
  const model = geminiModel();
  const generator = createVertexLessonClient(client);
  const prompt = lessonPrompt({
    type: input.type,
    nativeLanguage: languageById[input.nativeLanguage],
    targetLanguage: languageById[input.targetLanguage],
    level: input.level,
    recentTopics: input.recentTopics,
  });
  const config = lessonGenerationConfig();
  let sawInvalid = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const user = attempt === 0
      ? prompt
      : `${prompt}\n\nREPAIR: The previous response was refused, malformed, or repeated a recent topic. Produce a completely valid lesson with a different topic.`;
    const response = await generator.generateContent({ model, contents: user, config });
    if (blocked(response)) continue;
    let json: unknown;
    try {
      json = JSON.parse(response.text ?? "");
    } catch {
      sawInvalid = true;
      continue;
    }
    const parsed = GeneratedLessonSchema.safeParse(json);
    if (!parsed.success) {
      sawInvalid = true;
      continue;
    }
    const topic = parsed.data.topic.trim().toLocaleLowerCase();
    const repeated = input.recentTopics.some((recent) => recent.trim().toLocaleLowerCase() === topic);
    if (repeated) {
      sawInvalid = true;
      continue;
    }
    return parsed.data;
  }
  throw new Error(sawInvalid ? "MODEL_OUTPUT_INVALID" : "MODEL_OUTPUT_BLOCKED");
}
