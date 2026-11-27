import type { LanguageId } from "./languages.js";
import { applyTargetVoices, lessonDisplayText, repairMarkup, visibleLessonText } from "./markup.js";
import { targetAnswerText, tidyTargetAnswers } from "./answer-text.js";
import { ConversationSkillSchema, type ConversationSkill } from "./conversation-skills.js";
import { MAX_LESSON_SEGMENTS, type CefrLevel, type LessonSegment } from "./schemas.js";
import { groupBunsetsu, needsWordSegment, segmentWords, splitSentences } from "./segment.js";
import { dialogueText, normalizeSpeakerNames, type SpeakerNames } from "./speakers.js";
import { line, template, type TeachingKey } from "./teaching.js";
import { speakingPauseMs } from "./speaking-timing.js";
import { findKnownPhrase, phraseSimilarity, MAX_WARMUP_REVIEWS } from "./review.js";
import { quotesStayTrue } from "./quotes.js";
import { pieceOfLine, quotesOnScript, targetVocabulary, type TargetVocabulary } from "./on-script.js";
import { LEARNER_PLACEHOLDER } from "./learner-name.js";

/**
 * Pimsleur's 5s / 25s / 2min steps, counted in other items rather than in a
 * clock. The first recall comes after one later item, then after three, then
 * after six. A ten-minute gap belongs to the next lesson, not this one.
 */
export const REVIEW_GAPS = [1, 3, 6] as const;

export type ReviewSlot = { item: number; gap: number; afterItem: number };

/**
 * A conversation is four or five complete turns, and every turn is practised.
 * reviews caps the spaced recalls of earlier turns; roleplayPasses is how many
 * parts of the conversation the learner takes over at the end.
 */
export const conversationPacing = {
  A1: { turns: 5, minTurns: 3, phrases: 5, wordsPerTurn: 10, variation: true, reviews: 3, roleplayPasses: 1, thinkMs: 2_000, listenMs: 650 },
  A2: { turns: 5, minTurns: 3, phrases: 5, wordsPerTurn: 13, variation: true, reviews: 3, roleplayPasses: 1, thinkMs: 1_500, listenMs: 500 },
  B1: { turns: 5, minTurns: 3, phrases: 5, wordsPerTurn: 18, variation: true, reviews: 3, roleplayPasses: 1, thinkMs: 1_000, listenMs: 350 },
  B2: { turns: 5, minTurns: 3, phrases: 5, wordsPerTurn: 23, variation: true, reviews: 3, roleplayPasses: 1, thinkMs: 750, listenMs: 250 },
  C1: { turns: 5, minTurns: 3, phrases: 5, wordsPerTurn: 28, variation: true, reviews: 3, roleplayPasses: 1, thinkMs: 500, listenMs: 250 },
} as const satisfies Record<CefrLevel, {
  turns: number; minTurns: number; phrases: number; wordsPerTurn: number; variation: boolean;
  reviews: number; roleplayPasses: number; thinkMs: number; listenMs: number;
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

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The learner never says a name out loud: not a speaker's, not the teacher's,
 * and not their own (the {learner} placeholder). Names are capitalised in the
 * target text, so a lowercase word such as "will" is not mistaken for Will.
 * A transliteration ("Anna-san") is matched without case.
 */
export function mentionsName(text: string | undefined, names: SpeakerNames, ignoreCase = false): boolean {
  if (!text) return false;
  if (text.includes(LEARNER_PLACEHOLDER)) return true;
  return nameList(names).some((name) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeName(name)}(?![\\p{L}\\p{N}])`, ignoreCase ? "iu" : "u").test(text));
}

/**
 * A capitalised word, other than a sentence's first word, that appears exactly
 * the same in a line and in its translation, as "Max" does in "Ist Max da?" and
 * "Is Max there?". Names are not translated; ordinary nouns are. Used for
 * phrases saved from earlier lessons, whose speaker names are not known here.
 */
export function carriesProperName(item: { text: string; translation?: string | undefined }): boolean {
  if (!item.translation) return false;
  const capitalised = (value: string): Set<string> => {
    const found = new Set<string>();
    for (const match of value.matchAll(/(^|[^\p{L}\p{N}'’])(\p{Lu}[\p{Ll}\p{M}'’-]+)/gu)) {
      const before = value.slice(0, match.index + match[1]!.length).trimEnd();
      // The first word of a sentence is capitalised anyway.
      if (!before || /[.!?¡¿:;"“„«(]$/u.test(before)) continue;
      found.add(match[2]!);
    }
    return found;
  };
  const inText = capitalised(lessonDisplayText(item.text));
  if (inText.size === 0) return false;
  const inTranslation = capitalised(item.translation);
  return [...inText].some((word) => inTranslation.has(word));
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
  for (const name of [...nameList(names), LEARNER_PLACEHOLDER]) {
    const escaped = escapeName(name);
    result = result.replace(new RegExp(`^${escaped}\\s*[,!:;.\\-—]+\\s*`, "iu"), "").trim();
    // "Bis morgen, Anna!" keeps its closing mark: "Bis morgen!"
    result = result.replace(new RegExp(`\\s*[,!:;.\\-—]+\\s*${escaped}\\s*([!?.…]*)$`, "iu"), "$1").trim();
    // "Danke, Anna, bis morgen." keeps its words and loses the name.
    result = result.replace(new RegExp(`\\s*,\\s*${escaped}\\s*(?=[,!?.;:…])`, "giu"), "").trim();
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
    // An echo: the model, the learner's turn in the pause, then the model again.
    if (previous.pauseAfterMs) continue;
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

/** Rotates through every option, starting at the seed, and starts again when all are used. */
function cyclePicker(options: readonly string[], seed: number): () => string {
  let cursor = Math.abs(seed) % Math.max(1, options.length);
  return () => {
    const chosen = options[cursor % options.length] ?? options[0]!;
    cursor += 1;
    return chosen;
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

export type KnownLine = { text: string; translation?: string };

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
  /** Phrases from finished lessons. A dialogue line that repeats one is acknowledged, not drilled. */
  known?: KnownLine[];
  /** One teaching-language note on how a line uses the grammar from an earlier lesson. */
  grammarLink?: { text: string; note: string };
  /** Welcome lesson only: a few teaching-language lines on how the app works, before the lesson starts. */
  intro?: string[];
}): LessonSegment[] {
  const pacing = conversationPacing[input.level];
  const { cues, names, nativeLanguage, targetLanguage } = input;
  const lines = input.lines.slice(0, pacing.turns);
  const scene = new Set(lines.map((item) => normalizeChunk(item.text)));
  const knownList = input.known ?? [];
  // The learner never repeats a name, including one from an earlier lesson's cast.
  const speaksName = (item: PimsleurLine): boolean => mentionsName(item.text, names) || mentionsName(item.translation, names)
    || mentionsName(item.transliteration, names, true) || carriesProperName(item);
  const isKnown = (text: string): boolean => knownList.length > 0 && Boolean(findKnownPhrase(text, knownList, targetLanguage));
  // Every turn is practised, in the order of the conversation, unless the learner already knows it.
  const plans = focusPhrases(lines.filter((item) => item.language === targetLanguage), input.phrases, names, pacing.phrases, true);
  const fresh = plans.filter((plan) => !isKnown(plan.phrase.text));
  const priors = (input.priorReviews ?? []).filter((item) =>
    item.language === targetLanguage && item.translation && !scene.has(normalizeChunk(item.text))
    && !isEmptyDrill(item.text, names) && !speaksName(item) && fitsTurn(item, pacing.wordsPerTurn)).slice(0, MAX_WARMUP_REVIEWS);
  const variation = pacing.variation ? input.recombinations?.find((item) =>
    item.language === targetLanguage && item.translation && !scene.has(normalizeChunk(item.text)) && !speaksName(item)
    && fitsTurn(item, pacing.wordsPerTurn) && reusesFocus(item, fresh.map((plan) => plan.phrase))) : undefined;
  const seed = input.seed ?? hashSeed(lines.map((item) => item.text).join("|"));
  const nextPrompt = promptPicker(speakPromptPool(input.speakPrompts, cues, nativeLanguage), seed, nativeLanguage);
  const nextRepeat = cyclePicker(["repeatAfter1", "repeatAfter2"] as const, seed);
  const nextKnown = linePicker(priorLines(nativeLanguage, ["known1", "known2", "known3"]), seed);
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
  /**
   * "Repeat after Leo." Then Leo says the line, the learner repeats it in the
   * pause, and Leo says it once more as the answer. The invitation comes
   * first so the learner knows to copy the line they are about to hear.
   */
  const echo = (item: PimsleurLine, phase: string, answerPhase = phase): void => {
    const name = item.speaker === "speakerB" ? names.speakerB : names.speakerA;
    narrate(line(nativeLanguage, nextRepeat() as TeachingKey, { name }), phase);
    const { speaker, language, text, translation, transliteration } = item;
    // Repeating what was just heard needs no extra thinking time.
    push({
      speaker, language, text, kind: "example", phase, delivery: "clear",
      ...(translation ? { translation } : {}),
      ...(transliteration ? { transliteration } : {}),
    }, speakingPauseMs(item.text, item.language));
    modeled.add(normalizeChunk(item.text));
    play(item, answerPhase, "drill");
  };
  const ask = (item: PimsleurPhrase, phase: string, answerPhase = phase, cue?: string): void => {
    const meaning = meaningOf(item.translation);
    if (!meaning || !modeled.has(normalizeChunk(item.text))) return;
    const partner = item.speaker === "speakerA" ? names.speakerB : names.speakerA;
    const prompt = cue ?? nextPrompt({ translation: meaning, name: partner });
    const previous = segments.at(-1);
    const repeat = previous?.kind === "example" && previous.language === item.language
      && normalizeChunk(previous.text) === normalizeChunk(item.text);
    push({
      kind: "drill", speaker: "teacher", phase, language: nativeLanguage,
      text: cites(prompt, meaning) || (cue && repeat) ? prompt : meaningPrompt(meaning, nativeLanguage),
      delivery: "curious",
    }, speakingPauseMs(item.text, item.language) + pacing.thinkMs);
    play(item, answerPhase, "drill");
  };
  const linkNote = (text: string): void => {
    const link = input.grammarLink;
    if (link && normalizeChunk(link.text) === normalizeChunk(text)) narrate(link.note, "link", "explanation", pacing.listenMs);
  };

  for (const text of input.intro ?? []) narrate(text, "intro");
  narrate(cues.welcome, "intro");
  if (priors.length > 0) {
    const lead = linePicker(priorLines(nativeLanguage, ["lead1", "lead2", "lead3", "lead4"]), seed);
    const remember = linePicker(priorLines(nativeLanguage, ["remember1", "remember2", "remember3", "remember4"]), seed + 1);
    const transition = linePicker(priorLines(nativeLanguage, ["return1", "return2", "return3", "return4"]), seed + 2);
    narrate(lead(), "warmup");
    for (const prior of priors) {
      modeled.add(normalizeChunk(prior.text)); // Practised in a completed lesson.
      ask(prior, "warmup", "warmup", fillMeaning(remember(), meaningOf(prior.translation)));
    }
    narrate(transition(), "warmup");
  }

  for (const item of lines) play(item, "dialogue", "dialogue");
  narrate(cues.afterDialogue, "breakdown", "narration", pacing.listenMs);
  const linked = input.grammarLink && plans.some((plan) => normalizeChunk(plan.phrase.text) === normalizeChunk(input.grammarLink!.text));
  if (input.grammarLink && !linked) narrate(input.grammarLink.note, "link", "explanation", pacing.listenMs);

  // Practise each new turn, with spaced recalls of earlier turns slotted between them.
  const slots = scheduleReviewSlots(fresh.length, pacing.reviews);
  let builtUp = false;
  let freshIndex = 0;
  for (const plan of plans) {
    const { phrase, chunks } = plan;
    if (!fresh.includes(plan)) {
      narrate(nextKnown(), "known");
      present(phrase, "known");
      linkNote(phrase.text);
      continue;
    }
    narrate(explained(phrase, cues.listen), "breakdown", "explanation", pacing.listenMs);
    const pieces = buildupPieces(phrase, chunks);
    const beginner = input.level === "A1" || input.level === "A2";
    if (pieces.length === 0 && beginner) {
      // A short line for a beginner is simply repeated after the speaker.
      echo(phrase, "breakdown", "answer");
      linkNote(phrase.text);
    } else {
      present(phrase, "breakdown");
      linkNote(phrase.text);
    }
    if (pieces.length > 0) {
      if (!builtUp) narrate(cues.buildup, "buildup");
      builtUp = true;
      for (const piece of pieces) {
        if (piece.gloss) narrate(linkedGloss(piece.text, piece.gloss, piece.translation, phrase.language, nativeLanguage), "buildup", "explanation", pacing.listenMs);
        echo({ speaker: phrase.speaker, language: phrase.language, text: piece.text, ...(piece.translation ? { translation: piece.translation } : {}) }, "buildup");
      }
      ask(phrase, "recall", "answer", phrase.recallCue);
    } else if (!beginner) {
      ask(phrase, "recall", "answer", phrase.recallCue);
    }
    for (const slot of slots.filter((item) => item.afterItem === freshIndex)) {
      const earlier = fresh[slot.item];
      if (earlier && earlier !== plan) ask(earlier.phrase, "review");
    }
    freshIndex += 1;
  }
  for (const slot of slots.filter((item) => item.afterItem >= fresh.length)) {
    const earlier = fresh[slot.item];
    if (earlier) ask(earlier.phrase, "review");
  }

  if (input.usageTip) narrate(input.usageTip, "usage", "explanation", pacing.listenMs);
  if (variation) {
    narrate(explained(variation, cues.listen), "recombine", "explanation", pacing.listenMs);
    present(variation, "recombine");
    ask(variation, "recombine");
  }

  // Hear the whole exchange again, then take one part of it from memory.
  narrate(cues.again, "closing");
  for (const item of lines) play(item, "closing", "dialogue");
  for (const role of roleplayRoles(plans, fresh, pacing.roleplayPasses)) {
    narrate(line(nativeLanguage, "roleIntro", { name: role === "speakerA" ? names.speakerA : names.speakerB }), "roleplay");
    for (const item of lines) {
      const plan = plans.find((candidate) => normalizeChunk(candidate.phrase.text) === normalizeChunk(stripVocatives(item.text, names)));
      if (item.speaker === role && plan) ask(plan.phrase, "roleplay");
      else play(item, "roleplay", "dialogue");
    }
  }
  narrate(cues.closing, "closing", "recap");
  return enforcePromptAnswers(segments).map((segment) => ({ ...segment, text: clean(segment.text, names) || segment.text }));
}

/** The part with the most new lines first. A second pass takes the other part. */
function roleplayRoles(
  plans: Array<{ phrase: PimsleurPhrase }>,
  fresh: Array<{ phrase: PimsleurPhrase }>,
  passes: number,
): Array<"speakerA" | "speakerB"> {
  const count = (speaker: "speakerA" | "speakerB", list: Array<{ phrase: PimsleurPhrase }>) =>
    list.filter((plan) => plan.phrase.speaker === speaker).length;
  const roles = (["speakerA", "speakerB"] as const)
    .filter((speaker) => count(speaker, plans) > 0)
    .sort((left, right) => count(right, fresh) - count(left, fresh) || count(right, plans) - count(left, plans));
  return roles.slice(0, Math.max(0, passes));
}

/**
 * Pieces to build a line from the end. The model's pieces come first; a line
 * of four or more words without them is split from the end automatically.
 * The full line is never a piece, and at most two are kept, so the third
 * step is always the whole line.
 */
function buildupPieces(phrase: PimsleurPhrase, chunks: ChunkNote[]): ChunkNote[] {
  const full = normalizeChunk(phrase.text);
  const provided = chunks.filter((chunk) => chunk.text && normalizeChunk(chunk.text) !== full);
  if (provided.length > 0) return provided.slice(0, MAX_BUILDUP_CHUNKS - 1);
  if (spokenWords(phrase).length < 4) return [];
  return buildupChunks(phrase.text, phrase.language)
    .filter((part) => normalizeChunk(part) !== full)
    .slice(0, MAX_BUILDUP_CHUNKS - 1)
    .map((part) => ({ text: part }));
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
  const language = languageOf(record.language, fallbackLanguage, allowed);
  return {
    speaker: speakerOf(record.speaker, names),
    // A turn is only the target words, never "'Das Kind' means 'The child'".
    text: language === fallbackLanguage ? targetAnswerText(text, { translation, language }) : text,
    language,
    ...(translation ? { translation } : {}),
    ...(transliteration ? { transliteration } : {}),
  };
}

/**
 * Lines the model marked as already known. The mark is trusted only when the
 * line shares at least three quarters of its words with a phrase the learner
 * really knows, so a new line is never acknowledged as one they have learned.
 */
const KNOWN_MARK_SIMILARITY = 0.75;

function flaggedKnown(raw: unknown[], lines: PimsleurLine[], known: readonly KnownLine[], language: LanguageId): KnownLine[] {
  if (known.length === 0) return [];
  return raw.flatMap((value, index) => {
    const line = lines[index];
    if (!line || !value || typeof value !== "object" || (value as { known?: unknown }).known !== true) return [];
    // "Nearly the same" means one small word apart at most. Anything looser is a new line to drill.
    const close = known.some((phrase) => phraseSimilarity(line.text, phrase.text, language) >= KNOWN_MARK_SIMILARITY);
    return close ? [{ text: line.text, ...(line.translation ? { translation: line.translation } : {}) }] : [];
  });
}

/** A note on how one dialogue line uses the grammar from an earlier lesson. */
function grammarLinkFrom(value: unknown, lines: PimsleurLine[], names: SpeakerNames): { text: string; note: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const note = splitSentences(clean(textOf(record.note), names)).slice(0, 2).join(" ");
  if (!note || note.length > 280) return undefined;
  const wanted = normalizeChunk(textOf(record.line ?? record.text));
  const line = lines.find((item) => normalizeChunk(item.text) === wanted);
  // A note about a line that is not in the dialogue, or that quotes words the line does not have, is dropped.
  if (!line || !quotesStayTrue(note, [line.text], line.language)) return undefined;
  return { text: line.text, note };
}

function needsBuildup(text: string): boolean {
  return needsWordSegment(text) && !/\s/u.test(text);
}

/** The model's pieces, in the model's order. An unspaced line with no pieces is split into buildup chunks. */
function drillPlan(phrase: PimsleurPhrase, names: SpeakerNames): { phrase: PimsleurPhrase; chunks: ChunkNote[] } | null {
  const text = stripVocatives(phrase.text, names);
  if (isEmptyDrill(text, names)) return null;
  const translation = phrase.translation ? stripVocatives(phrase.translation, names) : undefined;
  // A name left inside the line ("Hallo Anna!", "Ich heiße Lukas.") would have the learner repeat it.
  // The line still plays in the dialogue; it is just not drilled.
  const transliteration = phrase.transliteration ? stripVocatives(phrase.transliteration, names) : undefined;
  if (mentionsName(text, names) || mentionsName(translation, names) || mentionsName(transliteration, names, true)) return null;
  const drilled: PimsleurPhrase = {
    ...phrase,
    text,
    ...(translation ? { translation } : {}),
    ...(transliteration ? { transliteration } : {}),
  };
  const full = normalizeChunk(text);
  const provided = (phrase.chunks ?? [])
    .map((note) => ({
      ...note,
      text: presentChunk(stripVocatives(note.text, names), text),
    }))
    .filter((note) => note.text && !isEmptyDrill(note.text, names) && !mentionsName(note.text, names) && normalizeChunk(note.text) !== full
      // A piece the model made up, rather than cut from this line, would be drilled out of nowhere.
      && pieceOfLine(note.text, text, phrase.language));
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

/**
 * The lines to practise. With every set, each translated turn is practised in
 * dialogue order, and the model's notes, pieces, and recall cues are merged in
 * by exact text. Otherwise only the model's focus lines are used.
 */
function focusPhrases(lines: PimsleurLine[], explicit: PimsleurPhrase[], names: SpeakerNames, limit: number, every = false) {
  const matched = (item: PimsleurLine) => explicit.find((candidate) => candidate.speaker === item.speaker
    && normalizeChunk(candidate.text) === normalizeChunk(item.text))
    ?? explicit.find((candidate) => normalizeChunk(candidate.text) === normalizeChunk(item.text));
  const preferred = explicit.flatMap((candidate) => {
    const matching = lines.find((item) => item.speaker === candidate.speaker
      && normalizeChunk(item.text) === normalizeChunk(candidate.text));
    return matching ? [{ ...candidate, ...matching }] : [];
  });
  const source = every
    ? lines.map((item) => {
      const extra = matched(item);
      return extra ? { ...phraseFor(item), ...extra, ...item } : phraseFor(item);
    })
    : preferred.length > 0 ? preferred : lines.map(phraseFor);
  const plans: Array<NonNullable<ReturnType<typeof drillPlan>>> = [];
  const seen = new Set<string>();
  for (const phrase of source) {
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

/** A phrase without any note, recall cue, or gloss that quotes target words the lesson never uses. */
function keepOnScript(phrase: PimsleurPhrase, vocabulary: TargetVocabulary): PimsleurPhrase {
  const { note, recallCue, chunks, ...rest } = phrase;
  return {
    ...rest,
    ...(note && quotesOnScript(note, vocabulary) ? { note } : {}),
    ...(recallCue && quotesOnScript(recallCue, vocabulary) ? { recallCue } : {}),
    ...(chunks ? {
      chunks: chunks.map(({ gloss, ...chunk }) => ({
        ...chunk,
        ...(gloss && quotesOnScript(gloss, vocabulary) ? { gloss } : {}),
      })),
    } : {}),
  };
}

/** The model's cues, with any cue that quotes words outside the lesson replaced by the standard one. */
function cuesOnScript(cues: LessonCues, vocabulary: TargetVocabulary, teaching: LanguageId): LessonCues {
  const standard = cuesFrom(undefined, teaching);
  const pick = (key: Exclude<keyof LessonCues, "echo">): string => quotesOnScript(cues[key], vocabulary) ? cues[key] : standard[key];
  return {
    welcome: pick("welcome"),
    listen: pick("listen"),
    afterDialogue: pick("afterDialogue"),
    buildup: pick("buildup"),
    howWouldYouSay: pick("howWouldYouSay"),
    sayIt: pick("sayIt"),
    yourTurn: pick("yourTurn"),
    ...(cues.echo ? { echo: cues.echo.filter((cue) => quotesOnScript(cue, vocabulary)) } : {}),
    again: pick("again"),
    closing: pick("closing"),
  };
}

export const MAX_WELCOME_INTRO_LINES = 4;

/**
 * The welcome lesson's opening: up to four short teaching-language sentences
 * on how learning with the app works. Each one is a single sentence, and
 * anything that is not a plain string is dropped.
 */
export function welcomeIntro(value: unknown, names: SpeakerNames): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? clean(item, names) : "")
    .map((item) => splitSentences(item)[0] ?? "")
    .filter((item) => item.length >= 3 && item.length <= 220)
    .slice(0, MAX_WELCOME_INTRO_LINES);
}

export function shapePimsleurLesson(value: unknown, context: {
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
  level: CefrLevel;
  priorReviews?: PimsleurPhrase[];
  /** Phrases from finished lessons, so a repeated line is acknowledged instead of drilled. */
  known?: KnownLine[];
  /** The learner's first lesson: keep the model's short appIntro about how the app works. */
  welcome?: boolean;
}): { title: string; topic: string; summary: string; conversationSkill?: ConversationSkill; speakerNames: SpeakerNames; segments: LessonSegment[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = visibleLessonText(textOf(record.title));
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
  if (explicitLines.length > 0 && (keptLines.length < pacing.minTurns || keptLines.length > pacing.turns
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
  // Teaching notes may only quote target words this lesson really uses.
  const vocabulary = targetVocabulary([
    ...keptLines.map((item) => item.text),
    ...recombinations.map((item) => item.text),
    ...(context.priorReviews ?? []).map((item) => item.text),
  ], context.targetLanguage);
  const onScriptPhrases = phrases.map((phrase) => keepOnScript(phrase, vocabulary));
  const onScriptCues = cuesOnScript(cues, vocabulary, context.nativeLanguage);
  const onScriptPrompts = speakPrompts.filter((prompt) => quotesOnScript(prompt, vocabulary));
  const known = [...(context.known ?? []), ...flaggedKnown(explicitLines, keptLines, context.known ?? [], context.targetLanguage)];
  const grammarLink = grammarLinkFrom(record.grammarLink, keptLines, names);
  const tip = splitSentences(clean(textOf(record.usageTip), names))[0];
  const usageTip = tip && quotesOnScript(tip, vocabulary) ? tip : undefined;
  const intro = context.welcome ? welcomeIntro(record.appIntro, names) : [];
  const arranged = arrangePimsleur({
    lines: keptLines,
    phrases: onScriptPhrases,
    cues: onScriptCues,
    names,
    nativeLanguage: context.nativeLanguage,
    targetLanguage: context.targetLanguage,
    level: context.level,
    ...(usageTip && usageTip.length <= 220 ? { usageTip } : {}),
    ...(onScriptPrompts.length > 0 ? { speakPrompts: onScriptPrompts } : {}),
    ...(context.priorReviews && context.priorReviews.length > 0 ? { priorReviews: context.priorReviews } : {}),
    ...(recombinations.length > 0 ? { recombinations } : {}),
    ...(known.length > 0 ? { known } : {}),
    ...(grammarLink ? { grammarLink } : {}),
    ...(intro.length > 0 ? { intro } : {}),
    seed: hashSeed(title),
  });
  if (!arranged.some((segment) => segment.phase === "answer")) return null;
  const segments = applyTargetVoices(tidyTargetAnswers(arranged, context.targetLanguage), context.nativeLanguage, context.targetLanguage).segments;
  const skill = ConversationSkillSchema.safeParse(record.conversationSkill);
  return {
    title: title.slice(0, 90),
    topic: visibleLessonText(textOf(record.topic) || title).slice(0, 160),
    summary: visibleLessonText(textOf(record.summary) || title).slice(0, 280),
    ...(skill.success ? { conversationSkill: skill.data } : {}),
    speakerNames: names,
    segments,
  };
}
