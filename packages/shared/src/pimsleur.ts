import type { LanguageId } from "./languages.js";
import { applyTargetVoices, repairMarkup } from "./markup.js";
import { ConversationSkillSchema, type ConversationSkill } from "./conversation-skills.js";
import { MAX_LESSON_SEGMENTS, type LessonSegment } from "./schemas.js";
import { dialogueText, normalizeSpeakerNames, type SpeakerNames } from "./speakers.js";
import { line, template, type TeachingKey } from "./teaching.js";
import { speakingPauseMs } from "./speaking-timing.js";

/**
 * Parakeet delayed a phrase's recall by one dialogue turn, then one more.
 * Those delays are about 25 seconds and 2 minutes of other material.
 * A 10 minute gap does not fit one lesson; Parakeet kept that step in FSRS, across lessons.
 */
export const REVIEW_INTERVALS_MS = [25_000, 120_000] as const;

/**
 * Pimsleur's 5s / 25s / 2min steps, counted in other items rather than in a
 * clock. The first recall comes after one later item, then after three, then
 * after six. A ten-minute gap belongs to the next lesson, not this one.
 */
export const REVIEW_GAPS = [1, 3, 6] as const;

export type ReviewSlot = { item: number; gap: number; afterItem: number };

export const MAX_DIALOGUE_LINES = 6;
/** One drilled phrase per dialogue turn. A 4-turn conversation is not cut down to 3. */
export const MAX_PHRASES = MAX_DIALOGUE_LINES;
export const MAX_BUILDUP_CHUNKS = 3;
/** Model-chosen pieces for one line. Zero means the line is drilled whole, in recall only. */
export const MAX_DRILL_CHUNKS = 6;
/** Room for every turn's buildup, recall, spaced review, and the closing replay. */
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
  closing: "That's the conversation. Nice work.",
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

function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(700, Math.round((words / 2.4) * 1_000));
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
export function buildupChunks(phrase: string): string[] {
  const raw = backwardChunks(phrase);
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
export function backwardChunks(phrase: string): string[] {
  const words = phrase.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length > 1) {
    const chunks: string[] = [];
    const start = Math.max(0, words.length - MAX_BUILDUP_CHUNKS);
    for (let index = words.length - 1; index >= start; index -= 1) chunks.push(words.slice(index).join(" "));
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

const RECALL_PHASES = new Set(["recall", "review", "warmup", "recombine", "roleplay"]);

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
    if (!prompt?.pauseAfterMs || prompt.speaker !== "teacher") continue;
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
    if (!prompt?.pauseAfterMs || prompt.speaker !== "teacher") continue;
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
    if (!segment.pauseAfterMs || segment.speaker !== "teacher") return segment;
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
  speakPrompts?: string[];
  seed?: number;
  estimateMs?: (text: string) => number;
  /** Phrases due from earlier lessons. Empty means this lesson stands alone. */
  priorReviews?: PimsleurPhrase[];
  recombinations?: PimsleurPhrase[];
  roleplay?: { stimulus: PimsleurLine; response: PimsleurPhrase };
}): LessonSegment[] {
  const estimate = input.estimateMs ?? estimateSpeechMs;
  const names = input.names;
  const lines = input.lines.slice(0, MAX_DIALOGUE_LINES);
  const phrases = phrasesForLines(lines, input.phrases.slice(0, MAX_PHRASES));
  const segments: LessonSegment[] = [];
  const nextPrompt = promptPicker(
    speakPromptPool(input.speakPrompts, input.cues, input.nativeLanguage),
    input.seed ?? hashSeed(lines.map((line) => line.text).join("|")),
    input.nativeLanguage,
  );
  const partnerName = (speaker: PimsleurPhrase["speaker"]): string => (
    speaker === "speakerA" ? names.speakerB : names.speakerA
  );
  let clock = 0;
  let ordinal = 0;
  const plans: Array<{ phrase: PimsleurPhrase; chunks: ChunkNote[] }> = [];
  for (const phrase of phrases) {
    const drilled = drillPlan(phrase, names);
    if (drilled) plans.push(drilled);
  }
  const taught = new Set(plans.map((plan) => normalizeChunk(plan.phrase.text)));
  const prior = (input.priorReviews ?? [])
    .map((phrase) => drillPlan(phrase, names)?.phrase)
    .filter((phrase): phrase is PimsleurPhrase => Boolean(phrase))
    .filter((phrase) => !taught.has(normalizeChunk(phrase.text)))
    .slice(0, 3);
  const warmup = prior.slice(0, 2);
  const mixed = prior.slice(2, 3);
  const fresh = (input.recombinations ?? [])
    .filter((phrase) => phrase.translation && !taught.has(normalizeChunk(phrase.text)) && !isEmptyDrill(phrase.text, names))
    .slice(0, 2);
  const role = input.roleplay && !isEmptyDrill(input.roleplay.response.text, names)
    && normalizeChunk(input.roleplay.stimulus.text) !== normalizeChunk(input.roleplay.response.text)
    && lines.some((line) => normalizeChunk(line.text) === normalizeChunk(input.roleplay?.stimulus.text ?? ""))
    ? input.roleplay
    : undefined;
  const responseAt = role ? plans.findIndex((plan) => normalizeChunk(plan.phrase.text) === normalizeChunk(role.response.text)) : -1;
  const roleAt = role && responseAt >= 0 ? (responseAt + 1 < plans.length ? responseAt + 1 : plans.length) : -1;
  const slots = scheduleReviewSlots(plans.length, Math.min(12, plans.length * 2));
  const afterSlot = new Map<number, ReviewSlot[]>();
  const ending: ReviewSlot[] = [];
  for (const slot of slots) {
    if (slot.afterItem >= plans.length) ending.push(slot);
    else afterSlot.set(slot.afterItem, [...(afterSlot.get(slot.afterItem) ?? []), slot]);
  }

  const reserved = lines.length + 2;
  const push = (
    segment: Omit<LessonSegment, "id" | "delivery"> & { delivery?: LessonSegment["delivery"] },
    pauseMs = 0,
    essential = false,
  ): boolean => {
    const limit = essential ? MAX_PIMSLEUR_SEGMENTS : MAX_PIMSLEUR_SEGMENTS - reserved;
    if (segments.length >= limit) return false;
    ordinal += 1;
    const pauseAfterMs = pauseMs > 0 ? pauseMs : undefined;
    segments.push({
      id: `seg_${String(ordinal).padStart(2, "0")}`,
      delivery: segment.delivery ?? "warm",
      ...segment,
      ...(pauseAfterMs ? { pauseAfterMs } : {}),
    });
    clock += estimate(segment.text) + pauseMs;
    return true;
  };

  const modeled = new Set<string>();
  const practicedChunks = new Set<string>();
  const echoes = uniquePrompts(input.cues.echo ?? []);
  const nextEcho = linePicker(echoes.length >= 2 ? echoes : uniquePrompts([
    input.cues.yourTurn, input.cues.sayIt, line(input.nativeLanguage, "echo1"),
    line(input.nativeLanguage, "echo2"), line(input.nativeLanguage, "echo3"),
  ]), input.seed ?? 0);
  const canAdd = (count: number, phrasesLeft: number): boolean => (
    segments.length + count + phrasesLeft * 4 <= MAX_PIMSLEUR_SEGMENTS - reserved
  );
  const present = (phrase: PimsleurPhrase, phase: string, explanation?: string): void => {
    if (explanation) push({
      kind: "explanation", speaker: "teacher", phase, language: input.nativeLanguage, text: explanation, delivery: "clear",
    });
    if (push({
      kind: "example", speaker: phrase.speaker, phase, language: phrase.language,
      text: phrase.text, ...(phrase.translation ? { translation: phrase.translation } : {}), delivery: "clear",
    })) modeled.add(normalizeChunk(phrase.text));
  };

  const ask = (
    phrase: PimsleurPhrase,
    promptPhase: string,
    answerPhase: string,
    promptText?: string,
  ): boolean => {
    const meaning = meaningOf(phrase.translation);
    if (!modeled.has(normalizeChunk(phrase.text)) || !meaning || !canAdd(2, 0)) return false;
    const prompt = promptText ?? nextPrompt({ translation: meaning, name: partnerName(phrase.speaker) });
    const precedingModel = segments.at(-1);
    const canEcho = precedingModel?.kind === "example" && precedingModel.language === phrase.language &&
      normalizeChunk(precedingModel.text) === normalizeChunk(phrase.text);
    const prompted = push({
      kind: "drill",
      speaker: "teacher",
      phase: promptPhase,
      language: input.nativeLanguage,
      text: cites(prompt, meaning) || (promptText && canEcho) ? prompt : meaningPrompt(meaning, input.nativeLanguage),
      delivery: "curious",
    }, speakingPauseMs(phrase.text, phrase.language));
    if (!prompted) return false;
    push({
      kind: "drill",
      speaker: phrase.speaker,
      phase: answerPhase,
      language: phrase.language,
      text: phrase.text,
      ...(phrase.translation ? { translation: phrase.translation } : {}),
      delivery: "clear",
    });
    return true;
  };
  const nextLead = linePicker(priorLines(input.nativeLanguage, ["lead1", "lead2", "lead3", "lead4"]), input.seed ?? 0);
  const nextReturn = linePicker(priorLines(input.nativeLanguage, ["return1", "return2", "return3", "return4"]), (input.seed ?? 0) + 1);
  const nextRemember = linePicker(priorLines(input.nativeLanguage, ["remember1", "remember2", "remember3", "remember4"]), (input.seed ?? 0) + 2);
  const nextBridge = linePicker(priorLines(input.nativeLanguage, ["bridge1", "bridge2", "bridge3", "bridge4"]), (input.seed ?? 0) + 3);
  const recallPrior = (phrase: PimsleurPhrase, phase: string, bridge: boolean): boolean => {
    const meaning = meaningOf(phrase.translation);
    if (!meaning) return false;
    const template = bridge ? nextBridge() : nextRemember();
    present(phrase, phase, `“${meaning}.”`);
    return ask(phrase, phase, phase, fillMeaning(template, meaning));
  };
  const practiceVariation = (phrase: PimsleurPhrase, phrasesLeft: number): boolean => {
    if (!canAdd(4, phrasesLeft)) return false;
    present(phrase, "recombine", explained(phrase, input.cues.listen));
    return ask(phrase, "recombine", "recombine");
  };
  const playRole = (phrasesLeft: number): void => {
    if (!role || !canAdd(3, phrasesLeft)) return;
    const reply = meaningOf(role.response.translation);
    if (!reply || !modeled.has(normalizeChunk(role.response.text))) return;
    const previous = segments[segments.length - 1];
    const repeated = previous
      && previous.speaker !== "teacher"
      && normalizeChunk(previous.text) === normalizeChunk(role.stimulus.text);
    if (!repeated) {
      push({
        kind: "dialogue",
        speaker: role.stimulus.speaker,
        phase: "roleplay",
        language: role.stimulus.language,
        text: role.stimulus.text,
        ...(role.stimulus.translation ? { translation: role.stimulus.translation } : {}),
        delivery: "warm",
      });
    }
    const asker = role.stimulus.speaker === "speakerA" ? names.speakerA : names.speakerB;
    const pronoun = role.stimulus.speaker === "speakerA" ? "him" : "her";
    const situation = meaningOf(role.stimulus.translation);
    const prompt = input.nativeLanguage.startsWith("en") && situation
      ? `${asker} asks you: ${situation}. Tell ${pronoun}: ${reply}.`
      : `${asker}: ${situation ? `${situation}. ` : ""}${reply}.`;
    push({
      kind: "drill",
      speaker: "teacher",
      phase: "roleplay",
      language: input.nativeLanguage,
      text: prompt,
      delivery: "curious",
    }, speakingPauseMs(role.response.text, role.response.language));
    push({
      kind: "drill",
      speaker: role.response.speaker,
      phase: "roleplay",
      language: role.response.language,
      text: role.response.text,
      ...(role.response.translation ? { translation: role.response.translation } : {}),
      delivery: "clear",
    });
  };

  push({
    kind: "narration",
    speaker: "teacher",
    phase: "intro",
    language: input.nativeLanguage,
    text: input.cues.welcome,
    delivery: "warm",
  });
  if (warmup.length > 0 && canAdd(warmup.length * 4 + 2 + lines.length + 1, plans.length)) {
    push({
      kind: "narration",
      speaker: "teacher",
      phase: "warmup",
      language: input.nativeLanguage,
      text: nextLead(),
      delivery: "warm",
    });
    for (const phrase of warmup) recallPrior(phrase, "warmup", false);
    push({
      kind: "narration",
      speaker: "teacher",
      phase: "warmup",
      language: input.nativeLanguage,
      text: nextReturn(),
      delivery: "warm",
    });
  }

  for (const line of lines) {
    push({
      kind: "dialogue",
      speaker: line.speaker,
      phase: "dialogue",
      language: line.language,
      text: line.text,
      ...(line.translation ? { translation: line.translation } : {}),
      ...(line.transliteration ? { transliteration: line.transliteration } : {}),
      delivery: "warm",
    });
  }

  push({
    kind: "narration",
    speaker: "teacher",
    phase: "breakdown",
    language: input.nativeLanguage,
    text: input.cues.afterDialogue,
    delivery: "warm",
  });

  let usedFresh = 0;
  let mixedIn = false;
  let playedRole = false;
  let introducedBuildup = false;
  for (let index = 0; index < plans.length; index += 1) {
    const drilled = plans[index];
    if (!drilled) continue;
    const phrasesLeft = plans.length - index - 1;
    push({
      kind: "explanation",
      speaker: "teacher",
      phase: "breakdown",
      language: input.nativeLanguage,
      text: explained(drilled.phrase, input.cues.listen),
      delivery: "clear",
    });
    let echoedChunk = false;
    if (drilled.chunks.length > 0) {
      if (!introducedBuildup && canAdd(3, phrasesLeft + 1)) {
        introducedBuildup = push({
          kind: "narration",
          speaker: "teacher",
          phase: "buildup",
          language: input.nativeLanguage,
          text: input.cues.buildup,
          delivery: "clear",
        });
      }
      const echo = drilled.chunks.find((chunk) => chunk.gloss && chunkTranslation(chunk, drilled.phrase))
        ?? drilled.chunks.find((chunk) => chunkTranslation(chunk, drilled.phrase));
      for (const chunk of drilled.chunks) {
        const translation = chunkTranslation(chunk, drilled.phrase);
        const gloss = chunk.gloss ? linkedGloss(chunk.text, chunk.gloss, translation, drilled.phrase.language, input.nativeLanguage) : undefined;
        const explanation = gloss ?? (translation ? `“${meaningOf(translation)}.”` : undefined);
        if (!canAdd(explanation ? 2 : 1, phrasesLeft + 1)) break;
        const part: PimsleurPhrase = {
          speaker: drilled.phrase.speaker,
          language: drilled.phrase.language,
          text: chunk.text,
          ...(translation ? { translation } : {}),
        };
        present(part, "buildup", explanation);
        const key = normalizeChunk(part.text);
        if (index % 3 !== 1 && chunk === echo && !practicedChunks.has(key) && canAdd(2, phrasesLeft + 1)) {
          echoedChunk = ask(part, "buildup", "buildup", nextEcho());
          if (echoedChunk) practicedChunks.add(key);
        }
      }
    }
    present(drilled.phrase, "breakdown");
    const contextualCue = drilled.phrase.recallCue;
    const recallCue = contextualCue && cites(contextualCue, meaningOf(drilled.phrase.translation)) ? contextualCue : undefined;
    ask(drilled.phrase, "recall", "answer", !echoedChunk && index % 3 === 0 ? nextEcho() : recallCue);
    for (const slot of afterSlot.get(index) ?? []) {
      const earlier = plans[slot.item]?.phrase;
      if (earlier && canAdd(2, phrasesLeft)) ask(earlier, "review", "review");
    }
    const freshPhrase = fresh[usedFresh];
    if (index >= 1 && freshPhrase && practiceVariation(freshPhrase, phrasesLeft)) usedFresh += 1;
    if (!mixedIn && mixed[0] && index >= 1 && canAdd(4, phrasesLeft)) {
      mixedIn = recallPrior(mixed[0], "review", true);
    }
    if (!playedRole && roleAt === index) {
      playRole(phrasesLeft);
      playedRole = true;
    }
  }
  for (const slot of ending) {
    const earlier = plans[slot.item]?.phrase;
    if (!earlier || !canAdd(2, 0)) break;
    ask(earlier, "review", "review");
  }
  const lastFresh = fresh[usedFresh];
  if (lastFresh) practiceVariation(lastFresh, 0);
  if (!mixedIn && mixed[0] && canAdd(4, 0)) mixedIn = recallPrior(mixed[0], "review", true);
  if (!playedRole && roleAt === plans.length) playRole(0);

  push({
    kind: "narration",
    speaker: "teacher",
    phase: "closing",
    language: input.nativeLanguage,
    text: input.cues.again,
    delivery: "warm",
  }, 0, true);
  for (const line of lines) {
    push({
      kind: "dialogue",
      speaker: line.speaker,
      phase: "closing",
      language: line.language,
      text: line.text,
      ...(line.translation ? { translation: line.translation } : {}),
      ...(line.transliteration ? { transliteration: line.transliteration } : {}),
      delivery: "warm",
    }, 0, true);
  }
  push({
    kind: "recap",
    speaker: "teacher",
    phase: "closing",
    language: input.nativeLanguage,
    text: input.cues.closing,
    delivery: "praise",
  }, 0, true);
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

function chunkTranslation(chunk: ChunkNote, phrase: PimsleurPhrase): string | undefined {
  if (chunk.translation) return chunk.translation;
  if (normalizeChunk(chunk.text) === normalizeChunk(phrase.text)) return phrase.translation;
  return undefined;
}

/** The model's pieces, in the model's order. No automatic word-by-word split. */
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
  const chunks = (phrase.chunks ?? [])
    .map((note) => ({
      ...note,
      text: presentChunk(stripVocatives(note.text, names), text),
    }))
    .filter((note) => note.text && !isEmptyDrill(note.text, names) && normalizeChunk(note.text) !== full);
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

/** One phrase per dialogue turn. A model phrase fills the matching turn; every other turn is still drilled. */
function phrasesForLines(lines: PimsleurLine[], explicit: PimsleurPhrase[]): PimsleurPhrase[] {
  const used = new Set<number>();
  const placed: Array<PimsleurPhrase | undefined> = lines.map(() => undefined);
  for (const phrase of explicit) {
    const index = lines.findIndex((line, position) => !used.has(position)
      && line.text === phrase.text
      && line.speaker === phrase.speaker);
    const fallback = index >= 0
      ? index
      : lines.findIndex((line, position) => !used.has(position) && line.text === phrase.text);
    if (fallback < 0) continue;
    used.add(fallback);
    placed[fallback] = { ...lines[fallback]!, ...phrase };
  }
  return lines.map((line, position) => placed[position] ?? phraseFor(line));
}

export function shapePimsleurLesson(value: unknown, context: {
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
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
  if (lines.length === 0) return null;
  const explicitPhrases = Array.isArray(record.phrases) ? record.phrases : [];
  const phrases = explicitPhrases.length > 0
    ? explicitPhrases
      .map((phrase) => {
        const line = lineFrom(phrase, names, context.targetLanguage, allowed);
        if (!line) return null;
        const note = textOf((phrase as { note?: unknown }).note);
        const recallCue = clean(textOf((phrase as { recallCue?: unknown }).recallCue), names).slice(0, 220);
        const chunks = notesFrom((phrase as { chunks?: unknown }).chunks ?? (phrase as { glosses?: unknown }).glosses, names);
        return {
          ...line,
          ...(note ? { note: clean(note, names) } : {}),
          ...(recallCue ? { recallCue } : {}),
          ...(chunks.length > 0 ? { chunks } : {}),
        };
      })
      .filter((phrase): phrase is PimsleurPhrase => Boolean(phrase))
    : [];
  const keptLines = lines.slice(0, MAX_DIALOGUE_LINES);
  const recombinations = Array.isArray(record.recombinations)
    ? record.recombinations
      .map((item) => lineFrom(item, names, context.targetLanguage, allowed))
      .filter((line): line is PimsleurLine => Boolean(line?.translation))
      .slice(0, 2)
    : [];
  const roleplay = roleplayFrom(record.roleplay, keptLines, names, context.targetLanguage, allowed);
  const arranged = arrangePimsleur({
    lines: keptLines,
    phrases: phrasesForLines(keptLines, phrases),
    cues,
    names,
    nativeLanguage: context.nativeLanguage,
    targetLanguage: context.targetLanguage,
    ...(speakPrompts.length > 0 ? { speakPrompts } : {}),
    ...(context.priorReviews && context.priorReviews.length > 0 ? { priorReviews: context.priorReviews } : {}),
    ...(recombinations.length > 0 ? { recombinations } : {}),
    ...(roleplay ? { roleplay } : {}),
    seed: hashSeed(title),
  });
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
