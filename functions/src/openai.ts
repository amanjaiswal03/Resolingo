import { createHmac } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  GeneratedLessonSchema,
  languageById,
  type CefrLevel,
  type GeneratedLesson,
  type LanguageId,
  type LessonType,
} from "@resolingo/shared";
import { OPENAI_API_KEY, OPENAI_LESSON_MODEL, SAFETY_IDENTIFIER_SECRET } from "./config.js";
import { lessonPrompt } from "./prompts.js";

export async function generateLessonContent(input: {
  uid: string;
  type: LessonType;
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
  level: CefrLevel;
  recentTopics: string[];
}): Promise<GeneratedLesson> {
  const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
  const safetyIdentifier = createHmac("sha256", SAFETY_IDENTIFIER_SECRET.value())
    .update(input.uid)
    .digest("hex");
  const prompt = lessonPrompt({
    type: input.type,
    nativeLanguage: languageById[input.nativeLanguage],
    targetLanguage: languageById[input.targetLanguage],
    level: input.level,
    recentTopics: input.recentTopics,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await client.responses.parse({
      model: OPENAI_LESSON_MODEL.value(),
      reasoning: { effort: "low" },
      safety_identifier: safetyIdentifier,
      input: [
        { role: "system", content: "You are Resolingo's expert multilingual lesson designer. Return only the requested validated lesson." },
        { role: "user", content: attempt === 0 ? prompt : `${prompt}\n\nREPAIR: The previous response was refused, malformed, or repeated a recent topic. Produce a completely valid lesson with a different topic.` },
      ],
      text: { format: zodTextFormat(GeneratedLessonSchema, "resolingo_lesson") },
    });
    if (!response.output_parsed) continue;
    const parsed = GeneratedLessonSchema.safeParse(response.output_parsed);
    if (!parsed.success) continue;
    const topic = parsed.data.topic.trim().toLocaleLowerCase();
    const repeated = input.recentTopics.some((recent) => recent.trim().toLocaleLowerCase() === topic);
    if (!repeated) return parsed.data;
  }
  throw new Error("MODEL_OUTPUT_INVALID");
}
