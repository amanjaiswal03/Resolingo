import type { LanguageId } from "./languages.js";
import { applyTargetVoices, lessonDisplayText, repairMarkup } from "./markup.js";
import { ConversationSkillSchema, type ConversationSkill } from "./conversation-skills.js";
import { MAX_LESSON_SEGMENTS, type CefrLevel, type LessonSegment } from "./schemas.js";
import { groupBunsetsu, needsWordSegment, segmentWords, splitSentences } from "./segment.js";
import { dialogueText, normalizeSpeakerNames, type SpeakerNames } from "./speakers.js";
import { line, template, type TeachingKey } from "./teaching.js";
import { speakingPauseMs } from "./speaking-timing.js";

/**
 * Pimsleur's 5s / 25s / 2min steps, counted in other items rather than in a
 * clock. The first recall comes after one later item, then after three, then
 * after six. A ten-minute gap belongs to the next lesson, not this one.
 */
export const REVIEW_GAPS = [1, 3, 6] as const;

export type ReviewSlot = { item: number; gap: number; afterItem: number };

export const conversationPacing = {
  A1: { turns: 4, phrases: 2, wordsPerTurn: 10, variation: false, thinkMs: 2_000, listenMs: 650 },
  A2: { turns: 4, phrases: 3, wordsPerTurn: 13, variation: false, thinkMs: 1_500, listenMs: 500 },
  B1: { turns: 5, phrases: 3, wordsPerTurn: 18, variation: true, thinkMs: 1_000, listenMs: 350 },
  B2: { turns: 6, phrases: 3, wordsPerTurn: 23, variation: true, thinkMs: 750, listenMs: 250 },
  C1: { turns: 6, phrases: 3, wordsPerTurn: 28, variation: true, thinkMs: 500, listenMs: 250 },
} as const satisfies Record<CefrLevel, {
  turns: number; phrases: number; wordsPerTurn: number;
  variation: boolean; thinkMs: number; listenMs: number;
}>;

export const MAX_BUILDUP_CHUNKS = 3;
export const MAX_DRILL_CHUNKS = 6;
export const MAX_PIMSLEUR_SEGMENTS = MAX_LESSON_SEGMENTS;

const VOWEL = /[aeiouyäöüáéíóúàèìòùâêîôûæøå]/i;

export type LessonCues = {
  welcome: string;
  listen: string;
  afterDialogue: string;
  buildup: string;
  howWouldYouSay: string;
  sayIt: string;
  yourTurn: string;
  echo?: string[];
  again: string;
  closing: string;
};

export const DEFAULT_CUES: LessonCues = {
  welcome: "Welcome. Just listen to the conversation.",
  listen: "Just listen.",
  afterDialogue: "You just heard the conversation. Now let's go through it.",
  buildup: "Let's build it up from the end.",
  howWouldYouSay: "How would you say",
  sayIt: "Say it out loud.",
  yourTurn: "Now you say it.",
  again: "Let's hear the conversation once more.",
  closing: "That's the conversation.",
};

/**
 * Teaching-language lines that ask the learner to speak. {translation} is the
 * meaning and {name} is the other speaker. Used when the model does not send
 * its own varied list. The picker rotates this pool and never repeats the
 * previous line.
 */
export const FALLBACK_SPEAK_PROMPTS = [
  "How would you say {translation}?",
  "Your turn.",
  "Give it a try.",
  "Can you say {translation}?",
  "Try saying {translation}.",
  "Imagine you want to tell {name} — what would you say?",
  "Repeat after me.",
  "Now you try.",
  "How would you ask for that?",
  "Say it out loud.",
  "Now you say it.",
] as const;

const MAX_SPEAK_PROMPTS = 12;
const MAX_GLOSSES = 2;
const INTERJECTIONS = new Set(["ah", "oh", "uh", "um", "hmm", "hm", "wow", "hey", "ach", "äh", "aeh", "ähm", "aehm", "na", "tja", "oy", "ooh", "oops"]);

export type PimsleurLine = {
  speaker: "speakerA" | "speakerB";
  text: string;
  translation?: string;
  transliteration?: string;
  language: LanguageId;
};

export type ChunkNote = { text: string; translation?: string; gloss?: string };

export type PimsleurPhrase = PimsleurLine & { note?: string; recallCue?: string; chunks?: ChunkNote[] };

/**
 * Place each item's recalls after 1, then 3, then 6 later items.
 * Only one recall is inserted at each boundary, so reviews sit between new
 * material instead of stacking. When the cap is tight, the nearest gaps stay
 * and the furthest ones are dropped.
 */
export function scheduleReviewSlots(itemCount: number, maxSlots: number): ReviewSlot[] {
  if (itemCount <= 0 || maxSlots <= 0) return [];
  type Pending = { item: number; gapIndex: number; after: number };
  const pending: Pending[] = [];
  const placed: ReviewSlot[] = [];
  const take = (slot: Pending, afterItem: number): void => {
    placed.push({ item: slot.item, gap: REVIEW_GAPS[slot.gapIndex] ?? REVIEW_GAPS[0], afterItem });
    const next = slot.gapIndex + 1;
    const gap = REVIEW_GAPS[next];
    if (next < REVIEW_GAPS.length && gap) pending.push({ item: slot.item, gapIndex: next, after: Math.max(afterItem + 1, slot.item + gap) });
  };
  for (let step = 0; step < itemCount; step += 1) {
    pending.push({ item: step, gapIndex: 0, after: step + REVIEW_GAPS[0] });
    const due = pending
      .filter((slot) => slot.after <= step)
      .sort((left, right) => left.after - right.after || left.item - right.item || left.gapIndex - right.gapIndex);
    const chosen = due[0];
    if (chosen && placed.length < maxSlots) {
      pending.splice(pending.indexOf(chosen), 1);
      take(chosen, step);
      for (const other of due) {
        if (other !== chosen && other.after <= step) other.after = step + 1;
      }
    }
  }
  pending.sort((left, right) => left.gapIndex - right.gapIndex || left.item - right.item || left.after - right.after);
  const leftover = pending[0];
  if (leftover && placed.length < maxSlots) {
    placed.push({ item: leftover.item, gap: REVIEW_GAPS[leftover.gapIndex] ?? REVIEW_GAPS[0], afterItem: itemCount });
  }
  return placed;
}

function splitSyllables(word: string): string[] {
  const groups = [...word.matchAll(/[aeiouyäöüáéíóúàèìòùâêîôûæøå]+|[^aeiouyäöüáéíóúàèìòùâêîôûæøå]+/giu)].map((match) => match[0]);
  if (groups.length <= 1) return [word];
  const syllables: string[] = [];
  let current = "";
  for (const group of groups) {
    const vowel = VOWEL.test(group);
    if (vowel && current && VOWEL.test(current)) {
      syllables.push(current);
      current = group;
    } else current += group;
  }
  if (current) syllables.push(current);
  const joined = syllables.join("");
  return joined === word && syllables.length > 1 ? syllables : [word];
}

/** Drop a question mark that belonged to the whole line, not to this ending. */
export function presentChunk(chunk: string, phrase: string): string {
  const trimmed = chunk.trim();
  const whole = phrase.trim();
  const question = /[?？]\s*$/u.test(whole) && normalizeChunk(trimmed) === normalizeChunk(whole);
  return question ? trimmed : trimmed.replace(/[?？]+\s*$/u, "").trim();
}

/**
 * Last word, then the last two words, then the whole line when it is longer.
 * The final step is always the full phrase, so the buildup ends on the sentence.
 */
export function buildupChunks(phrase: string, locale = "en-US"): string[] {
  const raw = backwardChunks(phrase, locale);
  if (raw.length === 0) return [];
  const spoken = raw.map((chunk) => presentChunk(chunk, phrase)).filter(Boolean);
  const full = presentChunk(phrase.trim(), phrase);
  if (!full) return spoken;
  if (normalizeChunk(spoken[spoken.length - 1] ?? "") === normalizeChunk(full)) return spoken;
  if (spoken.length === 1) return [full];
  return [...spoken.slice(0, -1), full];
}

function nameList(names: SpeakerNames): string[] {
  return [names.teacher, names.speakerA, names.speakerB].map((name) => name.trim()).filter(Boolean);
}

function bareWord(text: string): string {
  return text.replace(/[^\p{L}\p{N}'’-]+/gu, "").toLocaleLowerCase();
}

/** A chunk that is only a speaker's name or a throwaway interjection. */
export function isEmptyDrill(text: string, names: SpeakerNames): boolean {
  const token = bareWord(text);
  if (!token) return true;
  if (nameList(names).some((name) => name.toLocaleLowerCase() === token)) return true;
  return INTERJECTIONS.has(token);
}

/** Drop a leading or trailing "Anna," so the drill is the phrase, not the vocative. */
export function stripVocatives(text: string, names: SpeakerNames): string {
  let result = text.trim();
  for (const name of nameList(names)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`^${escaped}\\s*[,!:;.\\-—]+\\s*`, "iu"), "").trim();
    result = result.replace(new RegExp(`\\s*[,!:;.\\-—]+\\s*${escaped}\\s*[!?.…]*$`, "iu"), "").trim();
  }
  return result || text.trim();
}

/** Target-language drill audio is not played twice in a row. Dialogue may repeat a line. */
export function drillsAreUnique(segments: LessonSegment[]): boolean {
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (!previous || !current) continue;
    if (previous.phase === "dialogue" || previous.phase === "closing") continue;
    if (current.phase === "dialogue" || current.phase === "closing") continue;
    if (previous.speaker === "teacher" || current.speaker === "teacher") continue;
    if (previous.text === current.text && previous.language === current.language) return false;
  }
  return true;
}

/** Last word (or syllable) first, then a longer ending, then the whole phrase. */
export function backwardChunks(phrase: string, locale = "en-US"): string[] {
  const segmented = groupBunsetsu(segmentWords(phrase, locale), locale);
  const words = segmented.length > 0 ? segmented : phrase.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  const joiner = /\s/u.test(phrase) ? " " : "";
  if (words.length > 1) {
    const chunks: string[] = [];
    const start = Math.max(0, words.length - MAX_BUILDUP_CHUNKS);
    for (let index = words.length - 1; index >= start; index -= 1) chunks.push(words.slice(index).join(joiner));
    return chunks;
  }
  const word = words[0]!;
  if (word.length < 5) return [word];
  const syllables = splitSyllables(word);
  if (syllables.length <= 1) return [word];
  const chunks: string[] = [];
  const start = Math.max(0, syllables.length - MAX_BUILDUP_CHUNKS);
  for (let index = syllables.length - 1; index >= start; index -= 1) chunks.push(syllables.slice(index).join(""));
  return chunks;
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeChunk(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function fillPrompt(template: string, vars: { translation: string; name: string }): string {
  const translation = vars.translation.replace(/[.!?？。]+$/u, "");
  return template
    .split("{translation}").join(translation)
    .split("{name}").join(vars.name)
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 220);
}

function uniquePrompts(values: string[]): string[] {
  const seen = new Set<string>();
  const prompts: string[] = [];
  for (const value of values) {
    const trimmed = value.trim().slice(0, 180);
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    prompts.push(trimmed);
    if (prompts.length >= MAX_SPEAK_PROMPTS) break;
  }
  return prompts;
}

/** Model prompts when there are enough of them; otherwise the seeded fallback pool. */
export function speakPromptPool(modelPrompts: readonly string[] | undefined, cues: LessonCues, teaching: LanguageId = "en-US"): string[] {
  const provided = uniquePrompts([...(modelPrompts ?? [])]);
  if (provided.length >= 4) return provided;
  const ask = cues.howWouldYouSay.includes("{")
    ? cues.howWouldYouSay
    : `${cues.howWouldYouSay.replace(/[?？]\s*$/u, "")} {translation}?`;
  return uniquePrompts([ask, cues.sayIt, cues.yourTurn, ...provided, ...fallbackSpeakPrompts(teaching)]);
}

function fallbackSpeakPrompts(teaching: LanguageId): string[] {
  if (teaching === "en-US" || teaching === "en-GB" || teaching === "en-AU") return [...FALLBACK_SPEAK_PROMPTS];
  const keys = ["how", "plainTurn", "plainGive", "can", "try", "imagine", "repeat", "nowTry", "howAsk", "plainLoud", "plainNow"] as const;
  return keys.map((key) => template(teaching, key));
}

function promptPicker(templates: string[], seed: number, teaching: LanguageId): (vars: { translation?: string; name: string }) => string {
  const withMeaning = uniquePrompts(templates.filter((prompt) => prompt.includes("{translation}")));
  const meaningPool = withMeaning.length >= 2
    ? withMeaning
    : uniquePrompts([...withMeaning, template(teaching, "can"), template(teaching, "try"), template(teaching, "how")]);
  const withoutMeaning = uniquePrompts([
    ...templates.filter((prompt) => !prompt.includes("{translation}")),
    template(teaching, "repeat"),
    template(teaching, "nowTry"),
  ]);
  let meaningIndex = seed % meaningPool.length;
  let plainIndex = seed % withoutMeaning.length;
  let previous = "";
  return (vars) => {
    const pool = vars.translation ? meaningPool : withoutMeaning;
    let index = vars.translation ? meaningIndex : plainIndex;
    const fill = (template: string) => fillPrompt(template, { translation: vars.translation ?? "", name: vars.name });
    let chosen = fill(pool[index % pool.length]!);
    index += 1;
    if (!vars.translation) chosen = chosen.split("{translation}").join("").replace(/\s+/gu, " ").trim();
    if (chosen.toLocaleLowerCase() === previous.toLocaleLowerCase()) {
      for (let hop = 0; hop < pool.length; hop += 1) {
        let next = fill(pool[index % pool.length]!);
        index += 1;
        if (!vars.translation) next = next.split("{translation}").join("").replace(/\s+/gu, " ").trim();
        if (next.toLocaleLowerCase() !== previous.toLocaleLowerCase()) {
          chosen = next;
          break;
        }
      }
    }
    if (vars.translation) meaningIndex = index;
    else plainIndex = index;
    previous = chosen;
    const fallback = vars.translation
      ? line(teaching, "can", { translation: vars.translation.replace(/[.!?？。]+$/u, "") })
      : line(teaching, "repeat");
    return chosen || fallback;
  };
}

function meaningOf(value: string | undefined): string {
  return (value ?? "").replace(/[.!?？。]+$/u, "").trim();
}

/** The longest known meaning that actually appears in the prompt. */
function longestMeaning(prompt: string, meanings: string[]): string | undefined {
  const haystack = prompt.toLocaleLowerCase();
  return meanings
    .map((meaning) => meaningOf(meaning))
    .filter((meaning) => meaning.length >= 3 && haystack.includes(meaning.toLocaleLowerCase()))
    .sort((left, right) => right.length - left.length)[0];
}

const RECALL_PHASES = new Set(["recall", "review", "quick", "warmup", "recombine", "roleplay"]);
/** Cues that ask for something the learner should already know, without a fresh model. */
const MEMORY_CUE_PHASES = new Set(["review", "quick", "warmup"]);

/**
 * A memory cue is a native-language prompt, then a pause, then the target line.
 * The target line is not played again immediately before that prompt.
 */
export function recallAnswersFollowPrompts(segments: LessonSegment[]): boolean {
  for (let index = 0; index < segments.length; index += 1) {
    const prompt = segments[index];
    if (!prompt?.pauseAfterMs || prompt.speaker !== "teacher" || prompt.kind !== "drill") continue;
    if (!MEMORY_CUE_PHASES.has(prompt.phase ?? "")) continue;
    const answer = segments[index + 1];
    if (!answer || answer.language === prompt.language) return false;
    const meaning = meaningOf(answer.translation);
    if (!meaning || !cites(prompt.text, meaning)) return false;
    const previous = segments[index - 1];
    if (previous && previous.language === answer.language && normalizeChunk(previous.text) === normalizeChunk(answer.text)) return false;
  }
  return true;
}

/** Narrator lines that open a block of phrases from earlier lessons. */
function priorLines(teaching: LanguageId, keys: readonly TeachingKey[]): readonly string[] {
  return keys.map((key) => template(teaching, key));
}

function linePicker(options: readonly string[], seed: number): () => string {
  const used = new Set<string>();
  let cursor = Math.abs(seed) % options.length;
  return () => {
    for (let hop = 0; hop < options.length; hop += 1) {
      const line = options[(cursor + hop) % options.length] ?? options[0]!;
      const key = line.toLocaleLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      cursor = (cursor + hop + 1) % options.length;
      return line;
    }
    return options[cursor] ?? options[0]!;
  };
}

function fillMeaning(template: string, meaning: string): string {
  const spoken = /^I\b/u.test(meaning) ? meaning : `${meaning.charAt(0).toLocaleLowerCase()}${meaning.slice(1)}`;
  return template.replaceAll("{translation}", spoken);
}

/**
 * A phrase carried from an earlier lesson is announced before the learner is
 * asked for it. The warm-up block has one lead-in, and a phrase mixed in
 * later has its own bridge. The same line is not used twice.
 */
export function priorReviewsAreIntroduced(segments: LessonSegment[], priorTexts: readonly string[]): boolean {
  const wanted = new Set(priorTexts.map((text) => normalizeChunk(text)).filter(Boolean));
  if (wanted.size === 0) return true;
  const dialogueAt = segments.findIndex((segment) => segment.phase === "dialogue");
  let opened = false;
  let found = 0;
  const spoken = new Set<string>();
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment || segment.kind !== "drill" || segment.speaker === "teacher" || !wanted.has(normalizeChunk(segment.text))) continue;
    found += 1;
    const prompt = segments[index - 1];
    const meaning = meaningOf(segment.translation);
    if (!prompt || prompt.speaker !== "teacher" || !prompt.pauseAfterMs) return false;
    if (!meaning || !cites(prompt.text, meaning)) return false;
    if (!/remember how to say|recall how to say/i.test(prompt.text)) return false;
    const beforeDialogue = dialogueAt < 0 || index < dialogueAt;
    if (beforeDialogue && !opened) {
      const lead = segments.slice(0, index - 1).find((line) => line.phase === "warmup" && line.kind === "narration");
      if (!lead || lead.speaker !== "teacher" || lead.pauseAfterMs) return false;
      if (!/remember|recall|earlier|last time/i.test(lead.text)) return false;
      const leadKey = lead.text.trim().toLocaleLowerCase();
      if (spoken.has(leadKey)) return false;
      spoken.add(leadKey);
      opened = true;
    }
    if (!beforeDialogue && !/previous lesson|earlier lesson/i.test(prompt.text)) return false;
    const promptKey = prompt.text.trim().toLocaleLowerCase();
    if (spoken.has(promptKey)) return false;
    spoken.add(promptKey);
  }
  if (found !== wanted.size) return false;
  if (!opened) return false;
  let lastWarmup = -1;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment || (dialogueAt >= 0 && index >= dialogueAt)) break;
    if (wanted.has(normalizeChunk(segment.text))) lastWarmup = index;
  }
  if (lastWarmup < 0 || dialogueAt < 0) return false;
  return segments.slice(lastWarmup + 1, dialogueAt).some((segment) => (
    segment.speaker === "teacher" && /today's conversation/i.test(segment.text)
  ));
}

function cites(prompt: string, meaning: string): boolean {
  return meaning.length > 0 && prompt.toLocaleLowerCase().includes(meaning.toLocaleLowerCase());
}

/** The segment before the prompt is that same target line, so "Say it out loud" has something to echo. */
function justHeardTarget(segments: LessonSegment[], promptIndex: number, answer: LessonSegment): boolean {
  const previous = segments[promptIndex - 1];
  if (!previous || previous.language !== answer.language) return false;
  return normalizeChunk(previous.text) === normalizeChunk(answer.text);
}

/**
 * Every recall, review, warm-up, recombination, and role-play prompt names the
 * answer's meaning. A cue with no meaning is kept only when that exact target
 * line was the clip just before it.
 */
export function recallPromptsCiteMeanings(segments: LessonSegment[]): boolean {
  for (let index = 0; index < segments.length; index += 1) {
    const prompt = segments[index];
    if (!prompt?.pauseAfterMs || prompt.speaker !== "teacher" || prompt.kind !== "drill") continue;
    if (!RECALL_PHASES.has(prompt.phase ?? "")) continue;
    const answer = segments[index + 1];
    if (!answer || answer.speaker === "teacher") return false;
    const own = meaningOf(answer.translation);
    if (cites(prompt.text, own)) continue;
    if (prompt.phase !== "roleplay" && justHeardTarget(segments, index, answer)) continue;
    return false;
  }
  return true;
}

/**
 * A paused prompt is followed by its answer. If the prompt cites a meaning,
 * the longest one is that answer's meaning, never a longer line's translation.
 * A role-play cue may also mention what the other speaker asked.
 */
export function speakPromptsMatchAnswers(segments: LessonSegment[]): boolean {
  if (!recallPromptsCiteMeanings(segments)) return false;
  const known = segments.map((segment) => segment.translation).filter((translation): translation is string => Boolean(translation));
  for (let index = 0; index < segments.length; index += 1) {
    const prompt = segments[index];
    if (!prompt?.pauseAfterMs || prompt.speaker !== "teacher" || prompt.kind !== "drill") continue;
    const answer = segments[index + 1];
    if (!answer || answer.speaker === "teacher") return false;
    if (prompt.phase === "roleplay") continue;
    const own = meaningOf(answer.translation);
    const longest = longestMeaning(prompt.text, known);
    if (RECALL_PHASES.has(prompt.phase ?? "")) {
      if (justHeardTarget(segments, index, answer) && !longest) continue;
      if (!own || longest?.toLocaleLowerCase() !== own.toLocaleLowerCase()) return false;
      continue;
    }
    if (longest && longest.toLocaleLowerCase() !== own.toLocaleLowerCase()) return false;
  }
  return true;
}

function meaningPrompt(meaning: string, teaching: LanguageId): string {
  return line(teaching, "how", { translation: meaning });
}

function enforcePromptAnswers(segments: LessonSegment[]): LessonSegment[] {
  if (speakPromptsMatchAnswers(segments)) return segments;
  const known = segments.map((segment) => segment.translation).filter((translation): translation is string => Boolean(translation));
  return segments.map((segment, index) => {
    if (!segment.pauseAfterMs || segment.speaker !== "teacher" || segment.kind !== "drill") return segment;
    const answer = segments[index + 1];
    if (!answer || answer.speaker === "teacher") return segment;
    const own = meaningOf(answer.translation);
    const longest = longestMeaning(segment.text, known);
    const recall = RECALL_PHASES.has(segment.phase ?? "");
    if (segment.phase === "roleplay") {
      return cites(segment.text, own) ? segment : { ...segment, text: meaningPrompt(own, segment.language) };
    }
    if (recall) {
      if (justHeardTarget(segments, index, answer) && !longest) return segment;
      if (own && longest?.toLocaleLowerCase() === own.toLocaleLowerCase()) return segment;
      return own ? { ...segment, text: meaningPrompt(own, segment.language) } : segment;
    }
    if (!longest || longest.toLocaleLowerCase() === own.toLocaleLowerCase()) return segment;
    return { ...segment, text: own ? meaningPrompt(own, segment.language) : line(segment.language, "repeat") };
  });
}

function linkedGloss(chunk: string, gloss: string, translation: string | undefined, language: LanguageId, teaching: LanguageId): string {
  const wrapped = `[[lang:${language}]]${chunk}[[/lang]]`;
  if (gloss.includes("[[lang:") && gloss.includes(chunk)) return gloss.slice(0, 240);
  const glossCue = template(teaching, "gloss").split("{target}")[1]?.split("{meaning}")[0] ?? " means \"";
  if (gloss.includes(chunk) && (gloss.includes(glossCue.trim()) || /means|is how you say/i.test(gloss))) {
    return gloss.replace(chunk, wrapped).slice(0, 240);
  }
  const meaning = meaningOf(translation || gloss);
  return line(teaching, "gloss", { target: wrapped, meaning }).slice(0, 240);
}

function cueText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 180) : fallback;
}

export function cuesFrom(value: unknown, teaching: LanguageId = "en-US"): LessonCues {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fallback = {
    welcome: line(teaching, "cueWelcome"),
    listen: line(teaching, "cueListen"),
    afterDialogue: line(teaching, "cueAfter"),
    buildup: line(teaching, "cueBuildup"),
    howWouldYouSay: line(teaching, "cueHow"),
    sayIt: line(teaching, "cueSayIt"),
    yourTurn: line(teaching, "cueYourTurn"),
    again: line(teaching, "cueAgain"),
    closing: line(teaching, "cueClosing"),
  };
  return {
    welcome: cueText(record.welcome, fallback.welcome),
    listen: cueText(record.listen, fallback.listen),
    afterDialogue: cueText(record.afterDialogue, fallback.afterDialogue),
    buildup: cueText(record.buildup, fallback.buildup),
    howWouldYouSay: cueText(record.howWouldYouSay, fallback.howWouldYouSay),
    sayIt: cueText(record.sayIt, fallback.sayIt),
    yourTurn: cueText(record.yourTurn, fallback.yourTurn),
    ...(Array.isArray(record.echo) ? { echo: uniquePrompts(record.echo.filter((cue): cue is string => typeof cue === "string" && !cue.includes("{"))) } : {}),
    again: cueText(record.again, fallback.again),
    closing: cueText(record.closing, fallback.closing),
  };
}

function speakerOf(value: unknown, names: SpeakerNames): "speakerA" | "speakerB" {
  if (value === "speakerB" || value === names.speakerB) return "speakerB";
  return "speakerA";
}

function languageOf(value: unknown, fallback: LanguageId, allowed: readonly LanguageId[]): LanguageId {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as LanguageId : fallback;
}

function explained(phrase: PimsleurPhrase, listen: string): string {
  const note = phrase.note?.trim();
  const meaning = meaningOf(phrase.translation);
  if (note && (!meaning || cites(note, meaning))) return note;
  if (!meaning) return listen;
  return (note ? `${note} “${meaning}.”` : `“${meaning}.”`).slice(0, 900);
}

function clean(text: string, names: SpeakerNames): string {
  return repairMarkup(dialogueText(text, names)).trim();
}

export function arrangePimsleur(input: {
  lines: PimsleurLine[];
  phrases: PimsleurPhrase[];
  cues: LessonCues;
  names: SpeakerNames;
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
  level: CefrLevel;
  speakPrompts?: string[];
  seed?: number;
  usageTip?: string;
  priorReviews?: PimsleurPhrase[];
  recombinations?: PimsleurPhrase[];
  roleplay?: { stimulus: PimsleurLine; response: PimsleurPhrase };
}): LessonSegment[] {
  const pacing = conversationPacing[input.level];
  const { cues, names, nativeLanguage, targetLanguage } = input;
  const lines = input.lines.slice(0, pacing.turns);
  const plans = focusPhrases(lines.filter((item) => item.language === targetLanguage), input.phrases, names, pacing.phrases);
  const scene = new Set(lines.map((item) => normalizeChunk(item.text)));
  const prior = (input.priorReviews ?? []).find((item) =>
    item.language === targetLanguage && item.translation && !scene.has(normalizeChunk(item.text))
    && !isEmptyDrill(item.text, names) && fitsTurn(item, pacing.wordsPerTurn));
  const variation = pacing.variation ? input.recombinations?.find((item) =>
    item.language === targetLanguage && item.translation && !scene.has(normalizeChunk(item.text))
    && fitsTurn(item, pacing.wordsPerTurn) && reusesFocus(item, plans.map((plan) => plan.phrase))) : undefined;
  const role = input.roleplay;
  const seed = input.seed ?? hashSeed(lines.map((item) => item.text).join("|"));
  const nextPrompt = promptPicker(speakPromptPool(input.speakPrompts, cues, nativeLanguage), seed, nativeLanguage);
  const echoes = uniquePrompts(cues.echo ?? []);
  const nextEcho = linePicker(echoes.length >= 2 ? echoes : uniquePrompts([
    cues.yourTurn, cues.sayIt, line(nativeLanguage, "echo1"), line(nativeLanguage, "echo2"), line(nativeLanguage, "echo3"),
  ]), seed);
  const segments: LessonSegment[] = [];
  const modeled = new Set<string>();

  const push = (segment: Omit<LessonSegment, "id" | "delivery"> & { delivery?: LessonSegment["delivery"] }, pauseMs = 0): void => {
    segments.push({
      id: `seg_${String(segments.length + 1).padStart(2, "0")}`,
      delivery: "warm",
      ...segment,
      ...(pauseMs > 0 ? { pauseAfterMs: pauseMs } : {}),
    });
  };
  const narrate = (text: string, phase: string, kind: "narration" | "explanation" | "recap" = "narration", pauseMs = 0): void => {
    push({ kind, speaker: "teacher", phase, language: nativeLanguage, text }, pauseMs);
  };
  const play = (item: PimsleurLine, phase: string, kind: "dialogue" | "example" | "drill"): void => {
    const { speaker, language, text, translation, transliteration } = item;
    push({
      speaker, language, text, kind, phase, delivery: kind === "dialogue" ? "warm" : "clear",
      ...(translation ? { translation } : {}),
      ...(transliteration ? { transliteration } : {}),
    });
  };
  const present = (item: PimsleurLine, phase: string): void => {
    play(item, phase, "example");
    modeled.add(normalizeChunk(item.text));
  };
  const ask = (item: PimsleurPhrase, phase: string, answerPhase = phase, cue?: string): void => {
    const meaning = meaningOf(item.translation);
    if (!meaning || !modeled.has(normalizeChunk(item.text))) return;
    const partner = item.speaker === "speakerA" ? names.speakerB : names.speakerA;
    const prompt = cue ?? nextPrompt({ translation: meaning, name: partner });
    const previous = segments.at(-1);
    const echo = previous?.kind === "example" && previous.language === item.language
      && normalizeChunk(previous.text) === normalizeChunk(item.text);
    push({
      kind: "drill", speaker: "teacher", phase, language: nativeLanguage,
      text: cites(prompt, meaning) || (cue && echo) ? prompt : meaningPrompt(meaning, nativeLanguage),
      delivery: "curious",
    }, speakingPauseMs(item.text, item.language) + pacing.thinkMs);
    play(item, answerPhase, "drill");
  };

  narrate(cues.welcome, "intro");
  if (prior) {
    const lead = linePicker(priorLines(nativeLanguage, ["lead1", "lead2", "lead3", "lead4"]), seed);
    const remember = linePicker(priorLines(nativeLanguage, ["remember1", "remember2", "remember3", "remember4"]), seed + 1);
    const transition = linePicker(priorLines(nativeLanguage, ["return1", "return2", "return3", "return4"]), seed + 2);
    narrate(lead(), "warmup");
    modeled.add(normalizeChunk(prior.text)); // This item was practiced in a completed lesson.
    ask(prior, "warmup", "warmup", fillMeaning(remember(), meaningOf(prior.translation)));
    narrate(transition(), "warmup");
  }

  for (const item of lines) play(item, "dialogue", "dialogue");
  narrate(cues.afterDialogue, "breakdown", "narration", pacing.listenMs);

  let brokeDownPhrase = false;
  for (const [index, { phrase, chunks }] of plans.entries()) {
    narrate(explained(phrase, cues.listen), "breakdown", "explanation", pacing.listenMs);
    const chunk = chunks.find((item) => item.gloss) ?? chunks.find((item) => item.translation) ?? chunks[0];
    if (chunk && !brokeDownPhrase) {
      brokeDownPhrase = true;
      narrate(cues.buildup, "buildup");
      const translation = chunk.translation;
      if (chunk.gloss) narrate(linkedGloss(chunk.text, chunk.gloss, translation, phrase.language, nativeLanguage), "buildup", "explanation", pacing.listenMs);
      else if (translation) narrate(`“${meaningOf(translation)}.”`, "buildup", "explanation", pacing.listenMs);
      present({ speaker: phrase.speaker, language: phrase.language, text: chunk.text, ...(translation ? { translation } : {}) }, "buildup");
    }
    present(phrase, "breakdown");
    const echo = input.level === "A1" || (input.level === "A2" && index === 0);
    ask(phrase, "recall", "answer", echo ? nextEcho() : phrase.recallCue);

    // An intervening phrase gives the learner a chance to retrieve, without a fresh model.
    const earlier = plans[index - 1]?.phrase;
    if (earlier) ask(earlier, "review");
  }

  if (input.usageTip) narrate(input.usageTip, "usage", "explanation", pacing.listenMs);
  if (variation) {
    narrate(explained(variation, cues.listen), "recombine", "explanation", pacing.listenMs);
    present(variation, "recombine");
    ask(variation, "recombine");
  }
  const last = plans.at(-1)?.phrase;
  if (last && plans.length > 1) ask(last, "review");

  // Hear the same exchange with context before using the small set independently.
  narrate(cues.again, "closing");
  for (const item of lines) play(item, "closing", "dialogue");
  const first = plans[0]?.phrase;
  const checkOrder = first && normalizeChunk(first.text) === normalizeChunk(lines.at(-1)?.text ?? "")
    ? [...plans.slice(1), plans[0]!]
    : plans;
  for (const { phrase } of checkOrder) {
    if (role && normalizeChunk(role.response.text) === normalizeChunk(phrase.text)
      && normalizeChunk(role.stimulus.text) !== normalizeChunk(phrase.text)) {
      const asker = role.stimulus.speaker === "speakerA" ? names.speakerA : names.speakerB;
      const pronoun = role.stimulus.speaker === "speakerA" ? "him" : "her";
      const situation = meaningOf(role.stimulus.translation);
      const reply = meaningOf(phrase.translation);
      if (normalizeChunk(segments.at(-1)?.text ?? "") !== normalizeChunk(role.stimulus.text)) {
        play(role.stimulus, "roleplay", "dialogue");
      }
      const cue = nativeLanguage.startsWith("en") && situation
        ? `${asker} asks you: ${situation}. Tell ${pronoun}: ${reply}.`
        : line(nativeLanguage, "turn", { translation: reply });
      ask(phrase, "roleplay", "roleplay", cue);
    } else {
      const cue = input.level === "A1" || (input.level === "A2" && phrase === first) ? phrase.recallCue : undefined;
      ask(phrase, "quick", "quick", cue);
    }
  }
  narrate(cues.closing, "closing", "recap");
  return enforcePromptAnswers(segments).map((segment) => ({ ...segment, text: clean(segment.text, names) || segment.text }));
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lineFrom(value: unknown, names: SpeakerNames, fallbackLanguage: LanguageId, allowed: readonly LanguageId[]): PimsleurLine | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = clean(textOf(record.text ?? record.target), names).slice(0, 800);
  if (!text) return null;
  const translation = textOf(record.translation ?? record.native);
  const transliteration = textOf(record.transliteration);
  return {
    speaker: speakerOf(record.speaker, names),
    text,
    language: languageOf(record.language, fallbackLanguage, allowed),
    ...(translation ? { translation } : {}),
    ...(transliteration ? { transliteration } : {}),
  };
}

function roleplayFrom(
  value: unknown,
  lines: PimsleurLine[],
  names: SpeakerNames,
  fallbackLanguage: LanguageId,
  allowed: readonly LanguageId[],
): { stimulus: PimsleurLine; response: PimsleurPhrase } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const stimulusText = textOf(record.stimulus ?? record.prompt);
  const stimulus = lines.find((line) => normalizeChunk(line.text) === normalizeChunk(stimulusText));
  const response = lineFrom({
    speaker: record.speaker ?? record.responseSpeaker,
    text: record.text ?? record.response,
    translation: record.translation,
    language: record.language,
  }, names, fallbackLanguage, allowed);
  if (!stimulus || !response?.translation) return undefined;
  if (normalizeChunk(stimulus.text) === normalizeChunk(response.text)) return undefined;
  if (isEmptyDrill(response.text, names)) return undefined;
  const spoken = lines.find((line) => normalizeChunk(line.text) === normalizeChunk(response.text));
  return { stimulus, response: spoken ? { ...response, speaker: spoken.speaker } : response };
}

function needsBuildup(text: string): boolean {
  return needsWordSegment(text) && !/\s/u.test(text);
}

/** The model's pieces, in the model's order. An unspaced line with no pieces is split into buildup chunks. */
function drillPlan(phrase: PimsleurPhrase, names: SpeakerNames): { phrase: PimsleurPhrase; chunks: ChunkNote[] } | null {
  const text = stripVocatives(phrase.text, names);
  if (isEmptyDrill(text, names)) return null;
  const translation = phrase.translation ? stripVocatives(phrase.translation, names) : undefined;
  const drilled: PimsleurPhrase = {
    ...phrase,
    text,
    ...(translation ? { translation } : {}),
  };
  const full = normalizeChunk(text);
  const provided = (phrase.chunks ?? [])
    .map((note) => ({
      ...note,
      text: presentChunk(stripVocatives(note.text, names), text),
    }))
    .filter((note) => note.text && !isEmptyDrill(note.text, names) && normalizeChunk(note.text) !== full);
  const chunks = provided.length > 0 || !needsBuildup(text) || spokenWords(drilled).length < 5
    ? provided
    : buildupChunks(text, phrase.language)
      .filter((part) => normalizeChunk(part) !== full)
      .map((part) => ({ text: part }));
  return { phrase: drilled, chunks };
}

function notesFrom(value: unknown, names: SpeakerNames): ChunkNote[] {
  if (!Array.isArray(value)) return [];
  const notes: ChunkNote[] = [];
  let glosses = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const text = textOf(record.text ?? record.chunk);
    const translation = textOf(record.translation);
    const gloss = clean(textOf(record.gloss), names);
    if (!text && !translation) continue;
    const keepGloss = Boolean(gloss) && glosses < MAX_GLOSSES;
    if (keepGloss) glosses += 1;
    notes.push({
      text,
      ...(translation ? { translation: translation.slice(0, 180) } : {}),
      ...(keepGloss && gloss ? { gloss: gloss.slice(0, 240) } : {}),
    });
    if (notes.length >= MAX_DRILL_CHUNKS) break;
  }
  return notes;
}

function phraseFor(line: PimsleurLine): PimsleurPhrase {
  return { ...line, ...(line.translation ? { note: line.translation } : {}) };
}

/** Support turns stay in the scene. Only distinct, translated focus lines become questions. */
function focusPhrases(lines: PimsleurLine[], explicit: PimsleurPhrase[], names: SpeakerNames, limit: number) {
  const preferred = explicit.flatMap((candidate) => {
    const matching = lines.find((item) => item.speaker === candidate.speaker
      && normalizeChunk(item.text) === normalizeChunk(candidate.text));
    return matching ? [{ ...candidate, ...matching }] : [];
  });
  const plans: Array<NonNullable<ReturnType<typeof drillPlan>>> = [];
  const seen = new Set<string>();
  for (const phrase of preferred.length > 0 ? preferred : lines.map(phraseFor)) {
    const plan = drillPlan(phrase, names);
    if (!plan || !meaningOf(plan.phrase.translation)) continue;
    const key = normalizeChunk(plan.phrase.text);
    if (seen.has(key)) continue;
    seen.add(key);
    plans.push(plan);
    if (plans.length === limit) break;
  }
  return plans;
}

function spokenWords(item: PimsleurLine): string[] {
  return segmentWords(lessonDisplayText(item.text), item.language).map((word) => word.toLocaleLowerCase(item.language));
}

function fitsTurn(item: PimsleurLine, limit: number): boolean {
  return spokenWords(item).length <= limit;
}

function reusesFocus(item: PimsleurLine, phrases: PimsleurPhrase[]): boolean {
  const words = spokenWords(item);
  return phrases.some((phrase) => {
    const known = new Set(spokenWords(phrase));
    const reused = words.filter((word) => known.has(word)).length;
    return reused >= 2 && reused >= words.length - 2;
  });
}

export function shapePimsleurLesson(value: unknown, context: {
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
  level: CefrLevel;
  priorReviews?: PimsleurPhrase[];
}): { title: string; topic: string; summary: string; conversationSkill?: ConversationSkill; speakerNames: SpeakerNames; segments: LessonSegment[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = textOf(record.title);
  if (title.length < 3) return null;
  const names = normalizeSpeakerNames(record.speakerNames);
  const cues = cuesFrom(record.cues, context.nativeLanguage);
  const cueRecord = record.cues && typeof record.cues === "object" ? record.cues as Record<string, unknown> : {};
  const speakPrompts = Array.isArray(cueRecord.speak)
    ? cueRecord.speak.filter((item): item is string => typeof item === "string")
    : [];
  const explicitLines = Array.isArray(record.lines) ? record.lines : [];
  const segmentLines = Array.isArray(record.segments)
    ? record.segments.filter((segment) => {
      if (!segment || typeof segment !== "object") return false;
      const speaker = (segment as { speaker?: unknown }).speaker;
      return speaker === "speakerA" || speaker === "speakerB" || speaker === names.speakerA || speaker === names.speakerB;
    })
    : [];
  const rawLines = explicitLines.length > 0 ? explicitLines : segmentLines;
  const allowed = [context.nativeLanguage, context.targetLanguage] as const;
  const lines = rawLines
    .map((line) => lineFrom(line, names, context.targetLanguage, allowed))
    .filter((line): line is PimsleurLine => Boolean(line));
  const pacing = conversationPacing[context.level];
  const keptLines = explicitLines.length > 0 ? lines : lines.slice(0, pacing.turns);
  if (keptLines.length === 0) return null;
  if (explicitLines.length > 0 && (keptLines.length < 2 || keptLines.length > pacing.turns
      || keptLines.length !== explicitLines.length
      || keptLines.some((item) => item.language !== context.targetLanguage || !meaningOf(item.translation) || !fitsTurn(item, pacing.wordsPerTurn)))) {
    return null;
  }
  const explicitPhrases = Array.isArray(record.phrases) ? record.phrases : [];
  const phrases = explicitPhrases.length > 0
    ? explicitPhrases
      .map((phrase) => {
        const line = lineFrom(phrase, names, context.targetLanguage, allowed);
        if (!line) return null;
        const note = splitSentences(clean(textOf((phrase as { note?: unknown }).note), names))[0];
        const recallCue = clean(textOf((phrase as { recallCue?: unknown }).recallCue), names).slice(0, 220);
        const chunks = notesFrom((phrase as { chunks?: unknown }).chunks ?? (phrase as { glosses?: unknown }).glosses, names);
        return {
          ...line,
          ...(note && note.length <= 220 ? { note } : {}),
          ...(recallCue ? { recallCue } : {}),
          ...(chunks.length > 0 ? { chunks } : {}),
        };
      })
      .filter((phrase): phrase is PimsleurPhrase => Boolean(phrase))
    : [];
  const recombinations = Array.isArray(record.recombinations)
    ? record.recombinations
      .map((item) => lineFrom(item, names, context.targetLanguage, allowed))
      .filter((line): line is PimsleurLine => Boolean(line?.translation))
      .slice(0, 2)
    : [];
  const roleplay = roleplayFrom(record.roleplay, keptLines, names, context.targetLanguage, allowed);
  const usageTip = splitSentences(clean(textOf(record.usageTip), names))[0];
  const arranged = arrangePimsleur({
    lines: keptLines,
    phrases,
    cues,
    names,
    nativeLanguage: context.nativeLanguage,
    targetLanguage: context.targetLanguage,
    level: context.level,
    ...(usageTip && usageTip.length <= 220 ? { usageTip } : {}),
    ...(speakPrompts.length > 0 ? { speakPrompts } : {}),
    ...(context.priorReviews && context.priorReviews.length > 0 ? { priorReviews: context.priorReviews } : {}),
    ...(recombinations.length > 0 ? { recombinations } : {}),
    ...(roleplay ? { roleplay } : {}),
    seed: hashSeed(title),
  });
  if (!arranged.some((segment) => segment.phase === "answer")) return null;
  const segments = applyTargetVoices(arranged, context.nativeLanguage, context.targetLanguage).segments;
  const skill = ConversationSkillSchema.safeParse(record.conversationSkill);
  return {
    title: title.slice(0, 90),
    topic: (textOf(record.topic) || title).slice(0, 160),
    summary: (textOf(record.summary) || title).slice(0, 280),
    ...(skill.success ? { conversationSkill: skill.data } : {}),
    speakerNames: names,
    segments,
  };
}
