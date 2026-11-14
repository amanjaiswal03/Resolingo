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

export type PimsleurLine = {
  speaker: "speakerA" | "speakerB";
  text: string;
  translation?: string;
  transliteration?: string;
  language: LanguageId;
};

export type PimsleurPhrase = PimsleurLine & { note?: string };

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
  estimateMs?: (text: string) => number;
}): LessonSegment[] {
  const estimate = input.estimateMs ?? estimateSpeechMs;
  const names = input.names;
  const lines = input.lines.slice(0, MAX_DIALOGUE_LINES);
  const phrases = phrasesForLines(lines, input.phrases.slice(0, MAX_PHRASES));
  const segments: LessonSegment[] = [];
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
    const ask = input.cues.howWouldYouSay.replace(/[?？]\s*$/u, "");
    const instruction = input.cues.sayIt.replace(/[.。]\s*$/u, "");
    const question = `${ask} ${phrase.translation ?? phrase.text}?`;
    const prompt = question.toLocaleLowerCase().includes(instruction.toLocaleLowerCase())
      ? question
      : `${question} ${instruction}.`;
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
    const chunks = backwardChunks(phrase.text);
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
        push({
          kind: "drill",
          speaker: phrase.speaker,
          phase: "buildup",
          language: phrase.language,
          text: chunk,
          delivery: "clear",
        });
        push({
          kind: "drill",
          speaker: "teacher",
          phase: "buildup",
          language: input.nativeLanguage,
          text: input.cues.yourTurn,
          delivery: "curious",
        }, BUILDUP_PAUSE_MS);
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
  return segments.map((segment) => ({ ...segment, text: clean(segment.text, names) || segment.text }));
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
        return { ...line, ...(note ? { note: clean(note, names) } : {}) };
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
  });
  return {
    title: title.slice(0, 90),
    topic: (textOf(record.topic) || title).slice(0, 160),
    summary: (textOf(record.summary) || title).slice(0, 280),
    speakerNames: names,
    segments,
  };
}
