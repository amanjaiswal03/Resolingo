import { lessonDisplayText } from "./markup.js";
import type { KnownPhrase } from "./review.js";
import type { LessonSegment } from "./schemas.js";

/** A target-language line with its meaning, as it was taught. */
export type TaughtLine = { text: string; translation: string };

/** The grammar point from the learner's most recent grammar lesson. */
export type GrammarMemory = { ruleId?: string; title: string; examples: TaughtLine[] };

/** The scene from the learner's most recent conversation lesson. */
export type ConversationMemory = { title: string; topic: string; lines: TaughtLine[] };

/**
 * What the learner has met so far, so each lesson can build on the last one.
 * known lists phrases from finished lessons; the two memories come from the
 * most recent ready lesson of each type.
 */
export type LearnerContext = {
  known: KnownPhrase[];
  lastGrammar?: GrammarMemory;
  lastConversation?: ConversationMemory;
};

export const MAX_MEMORY_LINES = 6;
export const MAX_PROMPT_KNOWN = 40;

function taught(segments: readonly LessonSegment[], phases: ReadonlySet<string>, language: string): TaughtLine[] {
  const seen = new Set<string>();
  const lines: TaughtLine[] = [];
  for (const segment of segments) {
    if (!segment.phase || !phases.has(segment.phase) || segment.language !== language || !segment.translation) continue;
    const text = lessonDisplayText(segment.text).trim();
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    lines.push({ text, translation: lessonDisplayText(segment.translation).trim() });
    if (lines.length >= MAX_MEMORY_LINES) break;
  }
  return lines;
}

const GRAMMAR_PHASES = new Set(["hook", "example"]);
const DIALOGUE_PHASES = new Set(["dialogue"]);

export function grammarMemory(lesson: { title: string; topic: string; ruleId?: string | undefined; segments: readonly LessonSegment[] }, targetLanguage: string): GrammarMemory {
  return {
    ...(lesson.ruleId ? { ruleId: lesson.ruleId } : {}),
    title: lesson.topic || lesson.title,
    examples: taught(lesson.segments, GRAMMAR_PHASES, targetLanguage),
  };
}

export function conversationMemory(lesson: { title: string; topic: string; segments: readonly LessonSegment[] }, targetLanguage: string): ConversationMemory {
  return { title: lesson.title, topic: lesson.topic, lines: taught(lesson.segments, DIALOGUE_PHASES, targetLanguage) };
}

function asLines(value: unknown): TaughtLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim().slice(0, 240) : "";
    const translation = typeof record.translation === "string" ? record.translation.trim().slice(0, 240) : "";
    return text && translation ? [{ text, translation }] : [];
  }).slice(0, MAX_MEMORY_LINES);
}

/** Reads a stored memory defensively. Anything malformed is dropped, not thrown. */
export function parseGrammarMemory(value: unknown): GrammarMemory | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, 160) : "";
  if (!title) return undefined;
  const ruleId = typeof record.ruleId === "string" ? record.ruleId.trim().slice(0, 40) : "";
  return { ...(ruleId ? { ruleId } : {}), title, examples: asLines(record.examples) };
}

export function parseConversationMemory(value: unknown): ConversationMemory | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, 90) : "";
  const topic = typeof record.topic === "string" ? record.topic.trim().slice(0, 160) : "";
  const lines = asLines(record.lines);
  if (!title || lines.length === 0) return undefined;
  return { title, topic: topic || title, lines };
}
