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
  grammarTopicById,
  selectGrammarTopic,
  shapeGrammarLesson,
  shapePhraseLesson,
  shapePimsleurLesson,
  type CefrLevel,
  type GeneratedLesson,
  type LanguageId,
  type LearnerContext,
  type LessonPlan,
  type LessonType,
  type PimsleurPhrase,
} from "@resolingo/shared";
import { logger } from "firebase-functions";
import { DEFAULT_GEMINI_LESSON_MODEL, DEFAULT_GEMINI_LOCATION, GEMINI_LESSON_MODEL, GEMINI_LOCATION } from "./config.js";
import { lessonPrompt } from "./prompts.js";

const SYSTEM_INSTRUCTION = [
  "You are Resolingo's expert multilingual lesson designer. You teach with the Pimsleur method: graduated recall, anticipation (the learner answers before hearing the model), backward buildup of long lines, and lots of speaking.",
  "Return only a JSON object with title, topic, summary, conversationSkill, speakerNames, lines, phrases, and cues. Optional fields are usageTip, grammarLink, and recombinations.",
  "Write one complete conversation of four or five turns with one practical goal. It has a clear opening, a middle where the goal is reached, and a natural close, so it never stops mid-exchange. Every turn stays within the level's word limit and uses language the learner can be expected to say at that level.",
  "Each dialogue line has speaker (speakerA or speakerB), text, translation, and a BCP-47 language code. The learner practises every turn, so phrases has one entry for every line, in dialogue order, with the exact same speaker and text.",
  "Each phrase has a short teaching note on meaning or use. A line of four or more words has chunks: one or two pieces taken from the end of the line, growing toward the whole line, each with its own translation. Give a gloss only for a word the learner has not met before.",
  "Keep teaching notes short and conversational. An optional usageTip is one reliable observation that helps the learner use what they just heard, such as when the same wording sounds polite. Skip trivia, stereotypes, and extra vocabulary. Notes and transitions before a model invite listening only.",
  "A recombination changes one small detail of a taught line, such as the object or the time, and keeps the rest.",
  "When a line repeats a phrase the learner already knows, or differs by one small word at most, set known: true on that line. Prefer new lines, and keep at least three turns new. Never refer to earlier lessons inside the dialogue.",
  "When the learner's last grammar point is given, use it naturally in at least one line, and return grammarLink with line (that exact dialogue text) and note (one or two teaching-language sentences pointing out the pattern).",
  "cues has welcome, listen, afterDialogue, buildup, again, closing, and speak. closing is one short, calm, matter-of-fact wrap-up in the teaching language. No superlatives, no stacked exclamation marks, and no praise such as amazing, fantastic, or great job.",
  "speak has 4 to 6 conversational recall cues. Each includes {translation}. Some can include {name}. Vary the situation, instruction, and question styles without giving the target-language answer.",
  "A phrase can also have a recallCue with a natural situation specific to that line and its exact teaching-language meaning. The learner hears the meaning and a clear model before any of these cues.",
  "Also return speakerNames with teacher, speakerA, and speakerB. speakerA is male and speakerB is female. Each name is one Latin-script word of letters only, and the three names are different.",
  "speakerNames are only labels for the voices. The learner repeats every line out loud, so never put any person's name in a dialogue line, phrase, chunk, or recombination: no greeting or thanks by name, no self-introduction with a name, and no third person named. Do not write Speaker A or Speaker B.",
  "Every target-language word, including a gloss, a swap cue, a recap, and a closing, goes in its own [[lang:BCP-47]]...[[/lang]] span. Never leave a target word in a teaching-language span. Close every tag. Do not nest tags.",
  "Every text or answer field that the learner says is only the target-language words. Never put a gloss or translation in it, such as \"'Das Kind' means 'The child'\", \"Das Kind (the child)\", or quotation marks around the line, and never an inline marker such as [[gloss]] or an English word beside the target word. The meaning goes in translation. The only markup is [[lang:BCP-47]]...[[/lang]].",
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
  "Every text or answer field that the learner says is only the target-language words. Never put a gloss or translation in it, such as \"'Das Kind' means 'The child'\", \"Das Kind (the child)\", or quotation marks around the line, and never an inline marker such as [[gloss]] or an English word beside the target word. The meaning goes in translation. The only markup is [[lang:BCP-47]]...[[/lang]].",
].join(" ");

const GRAMMAR_INSTRUCTION = [
  "You are Resolingo's grammar teacher. You teach one pattern well: show it, let the learner notice it, explain it, break it down, then drill it from guided to free with spaced recall.",
  "Return only a JSON object for a lesson spoken by one teacher. Do not write a dialogue and do not use speakerA or speakerB as speakers.",
  "Teach only the narrow use named in the assigned grammar topic. Follow the learner level and the example and drill limits in the request. Use one practical outcome with familiar vocabulary.",
  "Fields: title, topic, summary, goal, speakerNames, hook, examples, noticeCue, notice, rule, breakdown, drills, recombinations, checks, closing, and targetTerms. Optional: bridge, and one usageTip or mnemonic.",
  "Use four short target-language examples with translations that isolate the same pattern. Ask the learner to notice one concrete change they have heard, then explain it simply.",
  "breakdown walks through the pattern in two or three short steps. Each step has explanation, one teaching-language sentence about one form or one position, and an optional example with text and translation.",
  "Order the drills from guided to free: a fill-the-gap with ___, then a transformation of a given sentence, then full sentences from the meaning alone. Supply support for the first try, then allow the learner to recall without hearing the answer again.",
  "recombinations apply the same rule in short real-life situations with familiar vocabulary. When the learner's last conversation is given, set them in that scene and reuse its words, and write bridge as one teaching-language sentence that quotes a line from that conversation word for word and connects it to today's rule. Never invent or alter a line from an earlier lesson.",
  "Use varied speaking cues and give the meaning or exact source sentence. Name whether the learner is speaking to a friend, a group, or formally when this changes the answer.",
  "Wrap every target-language span inside a teaching-language line as [[lang:BCP-47]]...[[/lang]], including isolated letters, stems, prefixes, endings, pronouns, and words spelled the same in both languages. Include the hyphen within an affix span. This applies to explanations, questions, answers, and drill cues. Close each tag, and never include teaching-language words inside it.",
  "targetTerms lists the exact target words and fragments used in teaching-language lines. Include stems and endings with their written hyphens.",
  "Every text or answer field that the learner says is only the target-language words. Never put a gloss or translation in it, such as \"'Das Kind' means 'The child'\", \"Das Kind (the child)\", or quotation marks around the line, and never an inline marker such as [[gloss]] or an English word beside the target word. The meaning goes in translation. The only markup is [[lang:BCP-47]]...[[/lang]].",
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
    /** What the learner already knows and studied last, for conversation and grammar lessons. */
    learner?: LearnerContext;
    /** The lesson of the day or welcome lesson this lesson was started from. */
    plan?: LessonPlan;
    /** The learner has a first name, so the model may write {learner} in a greeting and the closing. */
    addressLearner?: boolean;
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
  const planned = input.type === "grammar" && input.plan?.ruleId
    ? grammarTopicById(input.targetLanguage, input.level, input.plan.ruleId)
    : undefined;
  const grammarTopic = input.type === "grammar"
    ? planned ?? selectGrammarTopic({ language: input.targetLanguage, level: input.level, recentTopics: input.recentTopics })
    : undefined;
  const welcome = input.type === "conversation" && input.plan?.kind === "welcome";
  const conversationPlan = input.type === "conversation" && input.plan
    ? { scenario: input.plan.scenario, conversationSkill: input.plan.conversationSkill, welcome }
    : undefined;
  const prompt = lessonPrompt({
    type: input.type,
    nativeLanguage: languageById[input.nativeLanguage],
    targetLanguage: languageById[input.targetLanguage],
    level: input.level,
    recentTopics: input.recentTopics,
    ...(input.learner && input.type !== "phrase" ? { learner: input.learner } : {}),
    ...(grammarTopic ? { topic: grammarTopic } : {}),
    ...(conversationPlan ? { plan: conversationPlan } : {}),
    ...(input.addressLearner && input.type !== "phrase" ? { addressLearner: true } : {}),
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
    ? "Return complete grammar source for the assigned topic, with four distinct examples, a breakdown, and the full set of drills. Tag every target-language span with the requested language code."
    : input.type === "conversation"
    ? "Return a complete dialogue of four or five turns on a fresh topic, with an opening and a natural close. Check the level's word limit for every turn. Give phrases for every turn, with chunks for every turn of four or more words."
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
        ...(input.priorReviews && input.priorReviews.length > 0
          ? { priorReviews: input.priorReviews.flatMap((item) => item.translation ? [{ text: item.text, translation: item.translation }] : []) }
          : {}),
        ...(input.learner?.lastConversation ? { sceneLines: input.learner.lastConversation.lines.map((item) => item.text) } : {}),
      })
      : shapePimsleurLesson(json, {
        nativeLanguage: input.nativeLanguage,
        targetLanguage: input.targetLanguage,
        level: input.level,
        ...(input.type === "conversation" && input.priorReviews && input.priorReviews.length > 0 ? { priorReviews: input.priorReviews } : {}),
        ...(input.learner && input.learner.known.length > 0 ? { known: input.learner.known } : {}),
        ...(welcome ? { welcome: true } : {}),
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
    if (input.type === "conversation" && repeated && !conversationPlan?.scenario) {
      sawInvalid = true;
      continue;
    }
    return parsed.data;
  }
  throw new Error(sawInvalid ? "MODEL_OUTPUT_INVALID" : "MODEL_OUTPUT_BLOCKED");
}
