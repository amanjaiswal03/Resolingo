import {
  FinishReason,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from "@google/genai";
import {
  ConversationSkillSchema,
  GeneratedLessonSchema,
  dialogueText,
  languageById,
  markupIssues,
  normalizeSpeakerNames,
  repairMarkup,
  selectGrammarTopic,
  shapeGrammarLesson,
  shapePhraseLesson,
  shapePimsleurLesson,
  type CefrLevel,
  type GeneratedLesson,
  type LanguageId,
  type LessonType,
  type PimsleurPhrase,
} from "@resolingo/shared";
import { logger } from "firebase-functions";
import { DEFAULT_GEMINI_LESSON_MODEL, DEFAULT_GEMINI_LOCATION, GEMINI_LESSON_MODEL, GEMINI_LOCATION } from "./config.js";
import { lessonPrompt } from "./prompts.js";

const SYSTEM_INSTRUCTION = [
  "You are Resolingo's expert multilingual lesson designer.",
  "Return only a JSON object with title, topic, summary, conversationSkill, speakerNames, lines, phrases, and cues. Use one conversationSkill ID from the lesson prompt.",
  "lines is an array of 4 to 6 dialogue turns. Each line has speaker (speakerA or speakerB), text, translation, and a BCP-47 language code.",
  "phrases has one item for every line. Each phrase has speaker, text, translation, language, note, and chunks.",
  "A note teaches the meaning and one useful detail about when or how people say the line. Notes, glosses, and transitions before a model are teaching or listening lines, with no request to repeat, guess, or answer.",
  "chunks is optional and varies by line: empty for a short or easy line, otherwise a few meaningful pieces from the end of the sentence, not every word. Never a name-only chunk such as Anna. Each chunk has text and the translation of that chunk alone. A gloss, when needed, contains the chunk in [[lang]] tags and says what it means. Never a bare translation.",
  "recombinations is 0 to 2 new target sentences that combine earlier pieces, each with text and the translation of that new sentence. roleplay, when present, has stimulus (an earlier line), text (the learner's reply), and translation.",
  "cues has welcome, listen, afterDialogue, buildup, again, closing, speak, and echo. echo is 4 different brief teaching-language invitations to imitate a line the learner just heard.",
  "speak has 6 to 8 conversational recall cues. Each includes {translation}. Some can include {name}. Vary the situation, instruction, and question styles without giving the target-language answer.",
  "A phrase can also have a recallCue with a natural situation specific to that line and its exact teaching-language meaning. The learner hears the meaning and a clear model before any of these cues.",
  "Also return speakerNames with teacher, speakerA, and speakerB. speakerA is male and speakerB is female. Each name is one Latin-script word of letters only, and the three names are different.",
  "Use those exact names inside dialogue lines. Do not write Speaker A or Speaker B.",
  "Every target-language word, including a gloss, a swap cue, a recap, and a closing, goes in its own [[lang:BCP-47]]...[[/lang]] span. Never leave a target word in a teaching-language span. Close every tag. Do not nest tags.",
].join(" ");

const SAFETY_CATEGORIES = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
] as const;

const PHRASE_INSTRUCTION = [
  "You are Resolingo's phrase teacher.",
  "Return only JSON with title, topic, summary, speakerNames, pattern, chunks, swaps, situations, and roleplay.",
  "One teacher speaks the lesson. Do not write a dialogue and do not change the learner's target sentence.",
  "Teach a new word, with its article and a gloss, before the learner has to produce it. Every content word in an answer that is not in the original sentence goes in focus or in words, and is glossed on its own. A translation of the whole sentence does not teach a new word. If the word is the same in the teaching language, its translation is that same word.",
  "swaps is two items. Each changes one slot. Include from, to, focus, focusTranslation, answer, and translation. focus is the new target word with its article. The answer is a different sentence, not a copy of the original.",
  "Do not use a blunt will as a shop line. If will appears, add usage saying it is direct and fine with friends.",
  "situations is three or four, and every answer is a different sentence from the others and from the original. A shop uses the polite möchte, or that language's would like, with usage in one line. A friend can be more direct. Online uses a third wording. Register alternatives belong in situations.",
  "pattern is at most one short sentence, and only when the phrase has a notable structure.",
  "roleplay reuses a situation answer that was already taught. It is not the original sentence.",
  "Keep personal names and place names as names.",
  "Every target-language word in a teaching-language line, including a gloss, a pattern note, a swap cue, a recap, and a closing, is wrapped as [[lang:BCP-47]]...[[/lang]]. Close every tag. Do not nest tags.",
  "Do not drill a literal idiom gloss.",
].join(" ");

const GRAMMAR_INSTRUCTION = [
  "You are Resolingo's grammar teacher.",
  "Return only a JSON object for a lesson spoken by one teacher. Do not write a dialogue and do not use speakerA or speakerB as speakers.",
  "Teach the assigned grammar point and no other point. Do not add word order, negation, or a second tense.",
  "Fields: title, topic, summary, speakerNames, hook, examples, notice, rule, mnemonic, drills, checks, recombinations, targetTerms.",
  "hook and examples are distinct short target-language sentences with a native translation. The noticing answer must be true for this exact point.",
  "rule lists every form the examples use. For a verb, teach the full level-appropriate paradigm, one person first and the rest later.",
  "drills has at least 12 items: substitution, a transformation that includes the source sentence, a fill-the-gap with ___, and a which-form question. When the teaching language can mean a friend, a group, or a formal person, name which one. In English that is: you, to a friend; you all; or you, formally, and she versus they.",
  "The same cue sentence appears at most twice. Vary How would you say, Can you say, and Try saying, and always keep the meaning or the source sentence.",
  "recombinations has 2 new sentences that reuse the rule. Each cue includes the native meaning.",
  "Wrap every target-language span inside a teaching-language line as [[lang:BCP-47]]...[[/lang]], including isolated letters, stems, prefixes, endings, pronouns, and words spelled the same in both languages. Include the hyphen within an affix span. This applies to explanations, questions, answers, and drill cues. Close each tag, and never include teaching-language words inside it.",
  "targetTerms lists the exact target words and fragments used in teaching-language lines. Include stems and endings with their written hyphens.",
].join(" ");

export function lessonGenerationConfig(type: LessonType = "conversation"): GenerateContentConfig {
  // Vertex returns a generic HTTP 400 for responseSchema and responseJsonSchema
  // on gemini-3.5-flash-lite. JSON mode plus Zod is the check that accepts a response.
  return {
    systemInstruction: type === "grammar" ? GRAMMAR_INSTRUCTION : type === "phrase" ? PHRASE_INSTRUCTION : SYSTEM_INSTRUCTION,
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
  if (!ConversationSkillSchema.safeParse(record.conversationSkill).success) delete record.conversationSkill;
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

export type LessonModelPart = { text: string } | { inlineData: { mimeType: string; data: string } };
export type LessonModelContents = string | { role?: "user"; parts: LessonModelPart[] };

export type LessonModelClient = {
  generateContent(request: {
    model: string;
    contents: LessonModelContents;
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
    priorReviews?: PimsleurPhrase[];
    phrase?: {
      phraseId: string;
      nativeText: string;
      translation: string;
      transliteration?: string;
      alternatives?: { label: string; text: string; transliteration?: string }[];
      note?: string;
      inputLanguage?: "native" | "target" | "mixed" | "unknown";
    };
  },
  client?: LessonModelClient,
): Promise<GeneratedLesson> {
  const model = geminiModel();
  const generator = createVertexLessonClient(client);
  const grammarTopic = input.type === "grammar"
    ? selectGrammarTopic({ language: input.targetLanguage, level: input.level, recentTopics: input.recentTopics })
    : undefined;
  const prompt = lessonPrompt({
    type: input.type,
    nativeLanguage: languageById[input.nativeLanguage],
    targetLanguage: languageById[input.targetLanguage],
    level: input.level,
    recentTopics: input.recentTopics,
    ...(grammarTopic ? { topic: grammarTopic } : {}),
    ...(input.phrase ? {
      phrase: {
        nativeText: input.phrase.nativeText,
        translation: input.phrase.translation,
        alternatives: input.phrase.alternatives ?? [],
        ...(input.phrase.transliteration ? { transliteration: input.phrase.transliteration } : {}),
        ...(input.phrase.note ? { note: input.phrase.note } : {}),
      },
    } : {}),
  });
  const config = lessonGenerationConfig(input.type);
  let sawInvalid = false;
  let phraseRepair = "";
  const repair = input.type === "grammar"
    ? "Return complete grammar source for the assigned topic. Use distinct examples and tag every target-language span with the requested language code."
    : "The previous response was refused, malformed, or repeated a recent topic. Produce a completely valid lesson with a different topic.";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const user = attempt === 0
      ? prompt
      : `${prompt}\n\nREPAIR: ${phraseRepair || repair}`;
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
    if (input.type === "phrase") {
      const phraseLesson = shapePhraseLesson(json, {
        phraseId: input.phrase?.phraseId ?? "",
        nativeLanguage: input.nativeLanguage,
        targetLanguage: input.targetLanguage,
        level: input.level,
        nativeText: input.phrase?.nativeText ?? "",
        translation: input.phrase?.translation ?? "",
        ...(input.phrase?.transliteration ? { transliteration: input.phrase.transliteration } : {}),
        ...(input.phrase?.alternatives ? { alternatives: input.phrase.alternatives } : {}),
        ...(input.phrase?.note ? { note: input.phrase.note } : {}),
        ...(input.phrase?.inputLanguage ? { inputLanguage: input.phrase.inputLanguage } : {}),
      });
      if (!phraseLesson.ok) {
        sawInvalid = true;
        phraseRepair = `The phrase lesson was rejected (${phraseLesson.reason}${phraseLesson.detail ? `: ${phraseLesson.detail}` : ""}). Return JSON the shaper can accept: enough distinct swaps and situations, a short gloss of at most three words for every new word before the learner says it, at most two new glosses before each time the learner speaks, and no segments array. A phrase of more than one sentence is taught one sentence at a time, then together. A situation may keep just one of those sentences.`;
        logger.warn("phrase_lesson_shape_rejected", {
          reason: phraseLesson.reason,
          ...(phraseLesson.detail ? { detail: phraseLesson.detail } : {}),
        });
        continue;
      }
      const parsed = GeneratedLessonSchema.safeParse(phraseLesson.lesson);
      if (!parsed.success) {
        sawInvalid = true;
        logger.warn("lesson_schema_rejected", {
          issues: parsed.error.issues.slice(0, 8).map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
          })),
        });
        continue;
      }
      return parsed.data;
    }
    const shaped = input.type === "grammar"
      ? shapeGrammarLesson(json, {
        nativeLanguage: input.nativeLanguage,
        targetLanguage: input.targetLanguage,
        level: input.level,
        topic: grammarTopic!,
      })
      : shapePimsleurLesson(json, {
        nativeLanguage: input.nativeLanguage,
        targetLanguage: input.targetLanguage,
        ...(input.type === "conversation" && input.priorReviews && input.priorReviews.length > 0 ? { priorReviews: input.priorReviews } : {}),
      });
    if (!shaped) {
      sawInvalid = true;
      logger.warn("lesson_shape_rejected", { type: input.type });
      continue;
    }
    const parsed = GeneratedLessonSchema.safeParse(shaped);
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
    if (input.type === "conversation" && repeated) {
      sawInvalid = true;
      continue;
    }
    return parsed.data;
  }
  throw new Error(sawInvalid ? "MODEL_OUTPUT_INVALID" : "MODEL_OUTPUT_BLOCKED");
}
