import type { LanguageId } from "./languages.js";
import { repairMarkup } from "./markup.js";
import type { LessonSegment } from "./schemas.js";
import { dialogueText, normalizeSpeakerNames, type SpeakerNames } from "./speakers.js";

/** Parakeet's `five_second_break`: time for the learner to answer or repeat aloud. */
export const ANSWER_PAUSE_MS = 5_000;

/**
 * Parakeet delayed a phrase's recall by one dialogue turn, then one more.
 * Those delays are about 25 seconds and 2 minutes of other material.
 * A 10 minute gap does not fit one lesson; Parakeet kept that step in FSRS, across lessons.
 */
export const REVIEW_INTERVALS_MS = [25_000, 120_000] as const;

/** Echo a backward-buildup chunk, shorter than the full-phrase answer pause. */
export const BUILDUP_PAUSE_MS = 2_000;

export const MAX_DIALOGUE_LINES = 6;
/** One drilled phrase per dialogue turn. A 4-turn conversation is not cut down to 3. */
export const MAX_PHRASES = MAX_DIALOGUE_LINES;
export const MAX_BUILDUP_CHUNKS = 3;
/** Room for every turn's buildup, recall, spaced review, and the closing replay. */
export const MAX_PIMSLEUR_SEGMENTS = 96;

const VOWEL = /[aeiouyäöüáéíóúàèìòùâêîôûæøå]/i;

export type LessonCues = {
  welcome: string;
  listen: string;
  afterDialogue: string;
  buildup: string;
  howWouldYouSay: string;
  sayIt: string;
  yourTurn: string;
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

export type PimsleurLine = {
  speaker: "speakerA" | "speakerB";
  text: string;
  translation?: string;
  transliteration?: string;
  language: LanguageId;
};

export type ChunkNote = { text: string; translation?: string; gloss?: string };

export type PimsleurPhrase = PimsleurLine & { note?: string; chunks?: ChunkNote[] };

type Review = { phrase: PimsleurPhrase; step: number; dueAt: number };

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
export function speakPromptPool(modelPrompts: readonly string[] | undefined, cues: LessonCues): string[] {
  const provided = uniquePrompts([...(modelPrompts ?? [])]);
  if (provided.length >= 4) return provided;
  const ask = cues.howWouldYouSay.includes("{")
    ? cues.howWouldYouSay
    : `${cues.howWouldYouSay.replace(/[?？]\s*$/u, "")} {translation}?`;
  return uniquePrompts([ask, cues.sayIt, cues.yourTurn, ...provided, ...FALLBACK_SPEAK_PROMPTS]);
}

function promptPicker(templates: string[], seed: number): (vars: { translation?: string; name: string }) => string {
  const withMeaning = uniquePrompts(templates.filter((template) => template.includes("{translation}")));
  const meaningPool = withMeaning.length >= 2
    ? withMeaning
    : uniquePrompts([...withMeaning, "Can you say {translation}?", "Try saying {translation}.", "How would you say {translation}?"]);
  const withoutMeaning = uniquePrompts([
    ...templates.filter((template) => !template.includes("{translation}")),
    "Repeat after me.",
    "Now you try.",
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
    return chosen || (vars.translation ? `Can you say ${vars.translation.replace(/[.!?？。]+$/u, "")}?` : "Repeat after me.");
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

/**
 * A paused prompt is followed by its answer. The meaning inside the prompt is
 * that answer's meaning, never a longer line's translation.
 */
export function speakPromptsMatchAnswers(segments: LessonSegment[]): boolean {
  const known = segments.map((segment) => segment.translation).filter((translation): translation is string => Boolean(translation));
  for (let index = 0; index < segments.length; index += 1) {
    const prompt = segments[index];
    if (!prompt?.pauseAfterMs || prompt.speaker !== "teacher") continue;
    const answer = segments[index + 1];
    if (!answer || answer.speaker === "teacher") return false;
    const own = meaningOf(answer.translation);
    const longest = longestMeaning(prompt.text, known);
    if (own) {
      if (longest?.toLocaleLowerCase() !== own.toLocaleLowerCase()) return false;
    } else if (longest) return false;
  }
  return true;
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
    const matches = own
      ? longest?.toLocaleLowerCase() === own.toLocaleLowerCase()
      : !longest;
    return matches ? segment : { ...segment, text: "Repeat after me." };
  });
}

function linkedGloss(chunk: string, gloss: string, translation: string | undefined, language: LanguageId): string {
  const wrapped = `[[lang:${language}]]${chunk}[[/lang]]`;
  if (gloss.includes("[[lang:") && gloss.includes(chunk)) return gloss.slice(0, 240);
  if (gloss.includes(chunk) && /means|is how you say/i.test(gloss)) return gloss.replace(chunk, wrapped).slice(0, 240);
  const meaning = meaningOf(translation || gloss);
  return `${wrapped} means "${meaning}".`.slice(0, 240);
}

function cueText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 180) : fallback;
}

export function cuesFrom(value: unknown): LessonCues {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    welcome: cueText(record.welcome, DEFAULT_CUES.welcome),
    listen: cueText(record.listen, DEFAULT_CUES.listen),
    afterDialogue: cueText(record.afterDialogue, DEFAULT_CUES.afterDialogue),
    buildup: cueText(record.buildup, DEFAULT_CUES.buildup),
    howWouldYouSay: cueText(record.howWouldYouSay, DEFAULT_CUES.howWouldYouSay),
    sayIt: cueText(record.sayIt, DEFAULT_CUES.sayIt),
    yourTurn: cueText(record.yourTurn, DEFAULT_CUES.yourTurn),
    again: cueText(record.again, DEFAULT_CUES.again),
    closing: cueText(record.closing, DEFAULT_CUES.closing),
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
  if (note?.includes("[[lang:")) return note;
  const lead = note || listen;
  return `${lead} [[lang:${phrase.language}]]${phrase.text}[[/lang]]`.slice(0, 900);
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
}): LessonSegment[] {
  const estimate = input.estimateMs ?? estimateSpeechMs;
  const names = input.names;
  const lines = input.lines.slice(0, MAX_DIALOGUE_LINES);
  const phrases = phrasesForLines(lines, input.phrases.slice(0, MAX_PHRASES));
  const segments: LessonSegment[] = [];
  const nextPrompt = promptPicker(
    speakPromptPool(input.speakPrompts, input.cues),
    input.seed ?? hashSeed(lines.map((line) => line.text).join("|")),
  );
  const partnerName = (speaker: PimsleurPhrase["speaker"]): string => (
    speaker === "speakerA" ? names.speakerB : names.speakerA
  );
  const reviews: Review[] = [];
  let clock = 0;
  let ordinal = 0;

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

  const recall = (phrase: PimsleurPhrase): boolean => {
    const limit = MAX_PIMSLEUR_SEGMENTS - reserved;
    if (segments.length + 2 > limit) return false;
    const prompt = nextPrompt({
      ...(phrase.translation ? { translation: phrase.translation } : {}),
      name: partnerName(phrase.speaker),
    });
    push({
      kind: "drill",
      speaker: "teacher",
      phase: "recall",
      language: input.nativeLanguage,
      text: prompt,
      delivery: "curious",
    }, ANSWER_PAUSE_MS);
    push({
      kind: "drill",
      speaker: phrase.speaker,
      phase: "answer",
      language: phrase.language,
      text: phrase.text,
      ...(phrase.translation ? { translation: phrase.translation } : {}),
      delivery: "clear",
    });
    return true;
  };

  const drain = (): void => {
    for (let guard = 0; guard < phrases.length * REVIEW_INTERVALS_MS.length; guard += 1) {
      const ready = reviews
        .filter((review) => review.dueAt <= clock)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (!ready) return;
      if (!recall(ready.phrase)) {
        reviews.splice(0, reviews.length);
        return;
      }
      const nextStep = ready.step + 1;
      if (nextStep < REVIEW_INTERVALS_MS.length) {
        ready.step = nextStep;
        ready.dueAt = clock + (REVIEW_INTERVALS_MS[nextStep] ?? REVIEW_INTERVALS_MS[0]);
      } else {
        const index = reviews.indexOf(ready);
        if (index >= 0) reviews.splice(index, 1);
      }
    }
  };

  push({
    kind: "narration",
    speaker: "teacher",
    phase: "intro",
    language: input.nativeLanguage,
    text: input.cues.welcome,
    delivery: "warm",
  });

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

  for (const phrase of phrases) {
    drain();
    push({
      kind: "explanation",
      speaker: "teacher",
      phase: "breakdown",
      language: input.nativeLanguage,
      text: explained(phrase, input.cues.listen),
      delivery: "clear",
    });
    const chunks = alignChunks(buildupChunks(phrase.text), phrase);
    if (chunks.length > 1) {
      push({
        kind: "narration",
        speaker: "teacher",
        phase: "buildup",
        language: input.nativeLanguage,
        text: input.cues.buildup,
        delivery: "clear",
      });
      for (const chunk of chunks) {
        const translation = chunkTranslation(chunk, phrase);
        const gloss = chunk.gloss ? linkedGloss(chunk.text, chunk.gloss, translation, phrase.language) : undefined;
        const slots = 3 + (gloss ? 1 : 0);
        if (segments.length + slots > MAX_PIMSLEUR_SEGMENTS - reserved) break;
        push({
          kind: "drill",
          speaker: phrase.speaker,
          phase: "buildup",
          language: phrase.language,
          text: chunk.text,
          delivery: "clear",
        });
        if (gloss) {
          push({
            kind: "explanation",
            speaker: "teacher",
            phase: "buildup",
            language: input.nativeLanguage,
            text: gloss,
            delivery: "clear",
          });
        }
        push({
          kind: "drill",
          speaker: "teacher",
          phase: "buildup",
          language: input.nativeLanguage,
          text: nextPrompt({
            ...(translation ? { translation } : {}),
            name: partnerName(phrase.speaker),
          }),
          delivery: "curious",
        }, BUILDUP_PAUSE_MS);
        push({
          kind: "drill",
          speaker: phrase.speaker,
          phase: "buildup",
          language: phrase.language,
          text: chunk.text,
          ...(translation ? { translation } : {}),
          delivery: "clear",
        });
      }
    }
    if (recall(phrase)) reviews.push({ phrase, step: 0, dueAt: clock + REVIEW_INTERVALS_MS[0] });
  }
  drain();

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

function chunkTranslation(chunk: ChunkNote, phrase: PimsleurPhrase): string | undefined {
  if (chunk.translation) return chunk.translation;
  if (normalizeChunk(chunk.text) === normalizeChunk(phrase.text)) return phrase.translation;
  return undefined;
}

function alignChunks(spoken: string[], phrase: PimsleurPhrase): ChunkNote[] {
  const notes = phrase.chunks ?? [];
  return spoken.map((text, index) => {
    const key = normalizeChunk(text);
    const byText = notes.find((note) => note.text && normalizeChunk(presentChunk(note.text, phrase.text)) === key);
    const byIndex = notes[index];
    const indexed = byIndex && (!byIndex.text || normalizeChunk(presentChunk(byIndex.text, phrase.text)) === key)
      ? byIndex
      : undefined;
    const source = byText ?? indexed;
    return {
      text,
      ...(source?.translation ? { translation: source.translation } : {}),
      ...(source?.gloss ? { gloss: source.gloss } : {}),
    };
  });
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
    if (notes.length >= MAX_BUILDUP_CHUNKS) break;
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
    placed[fallback] = phrase;
  }
  return lines.map((line, position) => placed[position] ?? phraseFor(line));
}

export function shapePimsleurLesson(value: unknown, context: {
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
}): { title: string; topic: string; summary: string; speakerNames: SpeakerNames; segments: LessonSegment[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = textOf(record.title);
  if (title.length < 3) return null;
  const names = normalizeSpeakerNames(record.speakerNames);
  const cues = cuesFrom(record.cues);
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
        const chunks = notesFrom((phrase as { chunks?: unknown }).chunks ?? (phrase as { glosses?: unknown }).glosses, names);
        return {
          ...line,
          ...(note ? { note: clean(note, names) } : {}),
          ...(chunks.length > 0 ? { chunks } : {}),
        };
      })
      .filter((phrase): phrase is PimsleurPhrase => Boolean(phrase))
    : [];
  const keptLines = lines.slice(0, MAX_DIALOGUE_LINES);
  const segments = arrangePimsleur({
    lines: keptLines,
    phrases: phrasesForLines(keptLines, phrases),
    cues,
    names,
    nativeLanguage: context.nativeLanguage,
    targetLanguage: context.targetLanguage,
    ...(speakPrompts.length > 0 ? { speakPrompts } : {}),
    seed: hashSeed(title),
  });
  return {
    title: title.slice(0, 90),
    topic: (textOf(record.topic) || title).slice(0, 160),
    summary: (textOf(record.summary) || title).slice(0, 280),
    speakerNames: names,
    segments,
  };
}
