import {
  FinishReason,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from "@google/genai";
import {
  GeneratedLessonSchema,
  dialogueText,
  languageById,
  markupIssues,
  normalizeSpeakerNames,
  repairMarkup,
  shapePimsleurLesson,
  type CefrLevel,
  type GeneratedLesson,
  type LanguageId,
  type LessonType,
} from "@resolingo/shared";
import { logger } from "firebase-functions";
import { DEFAULT_GEMINI_LESSON_MODEL, DEFAULT_GEMINI_LOCATION, GEMINI_LESSON_MODEL, GEMINI_LOCATION } from "./config.js";
import { lessonPrompt } from "./prompts.js";

const SYSTEM_INSTRUCTION = [
  "You are Resolingo's expert multilingual lesson designer.",
  "Return only a JSON object with title, topic, summary, speakerNames, lines, phrases, and cues.",
  "lines is an array of 4 to 6 dialogue turns. Each line has speaker (speakerA or speakerB), text, translation, and a BCP-47 language code.",
  "phrases is an array of 2 or 3 items taken from those lines. Each phrase has speaker, text, translation, language, and note.",
  "cues has welcome, listen, afterDialogue, buildup, howWouldYouSay, again, and closing.",
  "Also return speakerNames with teacher, speakerA, and speakerB. speakerA is male and speakerB is female. Each name is one Latin-script word of letters only, and the three names are different.",
  "Use those exact names inside dialogue lines. Do not write Speaker A or Speaker B.",
  "When a line mixes the teaching language and the target language, wrap only the other-language span as [[lang:BCP-47]]...[[/lang]] and close every tag. Do not nest tags.",
].join(" ");

const SAFETY_CATEGORIES = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
] as const;

export function lessonGenerationConfig(): GenerateContentConfig {
  // Vertex returns a generic HTTP 400 for responseSchema and responseJsonSchema
  // on gemini-3.5-flash-lite. JSON mode plus Zod is the check that accepts a response.
  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    responseMimeType: "application/json",
    safetySettings: SAFETY_CATEGORIES.map((category) => ({
      category,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    })),
  };
}

const SEGMENT_KINDS = new Set(["narration", "dialogue", "explanation", "example", "drill", "recap"]);

function asJson(text: string | undefined): unknown {
  const parsed: unknown = JSON.parse(text ?? "");
  const value: unknown = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.title === "string") {
    if (typeof record.topic !== "string") record.topic = record.title;
    if (typeof record.summary !== "string") record.summary = record.title;
  }
  const names = normalizeSpeakerNames(record.speakerNames);
  record.speakerNames = names;
  if (!Array.isArray(record.segments)) return value;
  for (const segment of record.segments) {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) continue;
    const item = segment as Record<string, unknown>;
    const speaker = item.speaker === "speakerA" || item.speaker === "speakerB" ? item.speaker : "teacher";
    if (typeof item.kind !== "string" || !SEGMENT_KINDS.has(item.kind)) {
      if (typeof item.kind === "string") logger.warn("lesson_kind_coerced", { segmentId: item.id, kind: item.kind });
      item.kind = speaker === "teacher" ? "narration" : "dialogue";
    }
    if (typeof item.text === "string") {
      const named = dialogueText(item.text, names);
      const issues = markupIssues(named);
      item.text = issues.length > 0 ? repairMarkup(named) : named;
      if (issues.length > 0) logger.warn("lesson_markup_repaired", { segmentId: item.id, issues: issues.slice(0, 4) });
    }
  }
  return value;
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
      json = asJson(response.text);
    } catch {
      sawInvalid = true;
      const text = response.text ?? "";
      logger.warn("lesson_json_rejected", {
        length: text.length,
        startsWithBrace: text.trimStart().startsWith("{"),
      });
      continue;
    }
    const shaped = shapePimsleurLesson(json, {
      nativeLanguage: input.nativeLanguage,
      targetLanguage: input.targetLanguage,
    });
    const parsed = GeneratedLessonSchema.safeParse(shaped ?? json);
    if (!parsed.success) {
      sawInvalid = true;
      logger.warn("lesson_schema_rejected", {
        valueType: Array.isArray(json) ? "array" : typeof json,
        keys: json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json).slice(0, 8) : [],
        issues: parsed.error.issues.slice(0, 8).map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      });
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
