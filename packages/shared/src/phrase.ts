import type { LanguageId } from "./languages.js";
import type { CefrLevel, LessonSegment } from "./schemas.js";
import { MAX_LESSON_SEGMENTS } from "./schemas.js";
import { languageById } from "./languages.js";
import { repairMarkup } from "./markup.js";
import { ANSWER_PAUSE_MS, scheduleReviewSlots } from "./pimsleur.js";
import { normalizeSpeakerNames, type SpeakerNames } from "./speakers.js";

/** Lookups kept on the profile. Older ones are deleted on the next save. */
export const MAX_STORED_PHRASES = 100;
export const PHRASE_LOOKUP_LIMIT = 30;
export const PHRASE_LOOKUP_UNLIMITED = 100;

const SPEAK_FRAMES = [
  "How would you say {translation}?",
  "Can you say {translation}?",
  "Try saying {translation}.",
  "Give it a try: {translation}.",
  "Your turn: {translation}.",
  "Say it out loud: {translation}.",
  "Now you say it: {translation}.",
  "What would you say for {translation}?",
] as const;

const MAX_IDENTICAL_CUES = 2;

const SITUATIONS = [
  "You're in a shop. Someone asks what you need.",
  "You're ordering online and you have to say what you need.",
  "A friend asks what your plan is.",
  "You're somewhere a little more formal, and you still need the same thing.",
] as const;

export type PhraseAlternative = { label: string; text: string; transliteration?: string };
export type PhraseLine = { text: string; translation: string };
export type PhraseSwap = { from: string; to: string; source?: string; answer: string; translation: string };
export type PhraseSituation = { setup: string; answer: string; translation: string };

export type PhraseLessonContext = {
  phraseId: string;
  nativeLanguage: LanguageId;
  targetLanguage: LanguageId;
  level: CefrLevel;
  nativeText: string;
  translation: string;
  transliteration?: string;
  alternatives?: PhraseAlternative[];
  /** Literal gloss for an idiom. Spoken once. Never used as the line to drill. */
  note?: string;
  inputLanguage?: "native" | "target" | "mixed" | "unknown";
  priorReviews?: PhraseLine[];
};

type Drill = {
  kind: "chunk" | "phrase" | "swap" | "situation" | "roleplay";
  answer: string;
  translation: string;
  cues: string[];
  setup?: string;
  transliteration?: string;
};

/**
 * Same pace the lesson audio already uses. A1 and A2 stay slow; B1 eases off.
 * Phrase lessons pass the learner's level through to that speech path.
 */
export function phraseLessonPace(level: CefrLevel): "slow" | "moderate" | "natural" {
  if (level === "A1" || level === "A2") return "slow";
  if (level === "B1") return "moderate";
  return "natural";
}

export function phraseLookupLimit(unlimitedLessons: unknown): number {
  return unlimitedLessons === true ? PHRASE_LOOKUP_UNLIMITED : PHRASE_LOOKUP_LIMIT;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function hashKey(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Cache id for one learner query. The English frame in the placeholder does not create a second phrase. */
export function normalizePhraseQuery(text: string): string {
  return normalize(text.replace(/^\s*how would you say\b[:\s]*/i, ""));
}

export function phraseIdFor(targetLanguage: string, level: string, query: string): string {
  return `phrase_${hashKey(`${targetLanguage}:${level}:${normalizePhraseQuery(query)}`)}`;
}

export function phraseIdsToPrune(idsNewestFirst: readonly string[], keep = MAX_STORED_PHRASES): string[] {
  return idsNewestFirst.slice(keep);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function meaningOf(value: string): string {
  return value.replace(/[.!?？。]+$/u, "").trim();
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function same(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function linesOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function gloss(text: string, translation: string, language: LanguageId): string {
  return `[[lang:${language}]]${meaningOf(text)}[[/lang]] means "${meaningOf(translation)}".`;
}

function produceCues(translation: string): string[] {
  const meaning = meaningOf(translation);
  return SPEAK_FRAMES.map((frame) => frame.replaceAll("{translation}", meaning));
}

function sentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?？。]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function sceneCues(setup: string, translation: string): string[] {
  const meaning = meaningOf(translation);
  return [
    `${setup} How would you say ${meaning}?`,
    `${setup} Can you say ${meaning}?`,
    `${setup} Try saying ${meaning}.`,
    `${setup} Your turn: ${meaning}.`,
    `${setup} Say it out loud: ${meaning}.`,
    `${setup} Now you say it: ${meaning}.`,
  ];
}

function takeCue(candidates: string[], used: Map<string, number>, start: number): string | null {
  if (candidates.length === 0) return null;
  for (let hop = 0; hop < candidates.length; hop += 1) {
    const cue = candidates[(start + hop) % candidates.length]!;
    if ((used.get(cue) ?? 0) >= MAX_IDENTICAL_CUES) continue;
    used.set(cue, (used.get(cue) ?? 0) + 1);
    return cue;
  }
  return null;
}

function budget(level: CefrLevel): { chunks: number; swaps: number; situations: number; reviews: number } {
  if (level === "A1") return { chunks: 3, swaps: 2, situations: 2, reviews: 4 };
  if (level === "A2") return { chunks: 3, swaps: 3, situations: 3, reviews: 12 };
  return { chunks: 0, swaps: 3, situations: 4, reviews: 8 };
}

function readChunks(value: unknown, core: string): PhraseLine[] {
  const chunks: PhraseLine[] = [];
  for (const record of linesOf(value)) {
    const text = textOf(record.text);
    const translation = textOf(record.translation);
    if (!text || !translation || same(text, core)) continue;
    if (chunks.some((chunk) => same(chunk.text, text))) continue;
    chunks.push({ text, translation });
  }
  return chunks;
}

function readSwaps(value: unknown, core: string): PhraseSwap[] {
  const swaps: PhraseSwap[] = [];
  for (const record of linesOf(value)) {
    const answer = textOf(record.answer);
    const translation = textOf(record.translation);
    const from = textOf(record.from);
    const to = textOf(record.to);
    if (!answer || !translation || !from || !to || same(from, to) || same(answer, core)) continue;
    if (swaps.some((swap) => same(swap.answer, answer))) continue;
    const source = textOf(record.source);
    swaps.push({ from, to, answer, translation, ...(source ? { source } : {}) });
  }
  return swaps;
}

function readSituations(value: unknown): PhraseSituation[] {
  const situations: PhraseSituation[] = [];
  for (const record of linesOf(value)) {
    const setup = textOf(record.setup);
    const answer = textOf(record.answer);
    const translation = textOf(record.translation);
    if (!setup || !answer || !translation) continue;
    situations.push({ setup, answer, translation });
  }
  return situations;
}

function readRoleplay(value: unknown, core: string, meaning: string): PhraseSituation | null {
  const record = asRecord(value);
  if (!record) return null;
  const setup = textOf(record.setup);
  const answer = textOf(record.answer) || core;
  const translation = textOf(record.translation) || meaning;
  if (!setup || !answer || !translation || same(answer, textOf(record.note))) return null;
  return { setup, answer, translation };
}

function isLiteral(answer: string, note: string | undefined): boolean {
  if (!note) return false;
  return same(answer, note) || normalize(answer).includes(normalize(note));
}

/**
 * A paused prompt has to name the meaning, or name the slot it is changing.
 * A bare "Say it out loud" is not enough, because the learner cannot know which line.
 */
export function phrasePromptsAreClear(segments: LessonSegment[]): boolean {
  for (let index = 0; index < segments.length; index += 1) {
    const prompt = segments[index];
    if (!prompt?.pauseAfterMs) continue;
    const answer = segments[index + 1];
    if (!answer || prompt.speaker !== "teacher" || answer.speaker !== "teacher") return false;
    const meaning = meaningOf(answer.translation ?? "");
    const cites = meaning.length >= 2 && prompt.text.toLocaleLowerCase().includes(meaning.toLocaleLowerCase());
    const changes = /\b(change|swap|make it|instead)\b/i.test(prompt.text)
      && prompt.text.includes(":")
      && !same(prompt.text, answer.text);
    if (!cites && !changes) return false;
  }
  return true;
}

function introFor(context: PhraseLessonContext, targetLabel: string): string {
  const meaning = meaningOf(context.nativeText);
  if (context.inputLanguage === "target") {
    return `You already said this in ${targetLabel}. It means "${meaning}". We'll practice it in a few real situations.`;
  }
  if (context.inputLanguage === "mixed") {
    return `Part of that was already in ${targetLabel}. The whole sentence means "${meaning}". Let's learn it as one line.`;
  }
  return `You wanted to say "${meaning}". Here's how that sounds in ${targetLabel}.`;
}

export function shapePhraseLesson(
  value: unknown,
  context: PhraseLessonContext,
): { title: string; topic: string; ruleId: string; summary: string; speakerNames: SpeakerNames; segments: LessonSegment[] } | null {
  const core = context.translation.trim();
  const meaning = meaningOf(context.nativeText);
  if (core.length < 1 || meaning.length < 1 || context.phraseId.trim().length === 0 || context.phraseId.length > 40) return null;
  const source = asRecord(value) ?? {};
  const limits = budget(context.level);
  const note = textOf(context.note);
  const chunks = context.level === "A1" || context.level === "A2"
    ? readChunks(source.chunks, core).slice(0, limits.chunks)
    : [];
  const swaps = readSwaps(source.swaps, core).filter((swap) => !isLiteral(swap.answer, note)).slice(0, limits.swaps);
  if (swaps.length < limits.swaps) return null;
  const givenSituations = readSituations(source.situations).filter((item) => !isLiteral(item.answer, note));
  const situations = [...givenSituations];
  for (const setup of SITUATIONS) {
    if (situations.length >= limits.situations) break;
    if (situations.some((item) => same(item.setup, setup))) continue;
    situations.push({ setup, answer: core, translation: meaning });
  }
  if (situations.length < limits.situations) return null;
  const roleplay = readRoleplay(source.roleplay, core, meaning)
    ?? {
      setup: "You're in a shop. The person there asks what you need. Tell them.",
      answer: core,
      translation: meaning,
    };
  if (isLiteral(roleplay.answer, note)) return null;

  const drills: Drill[] = [];
  for (const chunk of chunks) {
    drills.push({
      kind: "chunk",
      answer: chunk.text,
      translation: chunk.translation,
      cues: produceCues(chunk.translation),
    });
  }
  drills.push({
    kind: "phrase",
    answer: core,
    translation: meaning,
    cues: produceCues(meaning),
    ...(context.transliteration ? { transliteration: context.transliteration } : {}),
  });
  for (const swap of swaps) {
    const sourceLine = swap.source && !same(swap.source, swap.answer) ? swap.source : core;
    const clear = meaningOf(swap.translation);
    drills.push({
      kind: "swap",
      answer: swap.answer,
      translation: clear,
      cues: [
        `Change ${swap.from} to ${swap.to}: ${sentence(sourceLine)} The meaning is ${clear}.`,
        `Now make it ${swap.to}: ${sentence(sourceLine)} The meaning is ${clear}.`,
        `Swap ${swap.from} for ${swap.to}: ${sentence(sourceLine)} The meaning is ${clear}.`,
        ...produceCues(clear),
      ],
    });
  }
  for (const situation of situations) {
    const clear = meaningOf(situation.translation);
    drills.push({
      kind: "situation",
      setup: situation.setup,
      answer: situation.answer,
      translation: clear,
      cues: sceneCues(situation.setup, clear),
    });
  }
  const roleMeaning = meaningOf(roleplay.translation);
  drills.push({
    kind: "roleplay",
    setup: roleplay.setup,
    answer: roleplay.answer,
    translation: roleMeaning,
    cues: sceneCues(roleplay.setup, roleMeaning),
  });

  const segments: LessonSegment[] = [];
  const used = new Map<string, number>();
  let ordinal = 0;
  const push = (segment: Omit<LessonSegment, "id" | "speaker" | "delivery"> & { delivery?: LessonSegment["delivery"] }, pauseMs = 0): boolean => {
    if (segments.length >= MAX_LESSON_SEGMENTS) return false;
    const text = repairMarkup(segment.text).trim();
    if (!text || segments.at(-1)?.text === text) return true;
    ordinal += 1;
    segments.push({
      id: `seg_${String(ordinal).padStart(2, "0")}`,
      speaker: "teacher",
      delivery: segment.delivery ?? "warm",
      ...segment,
      text,
      ...(pauseMs > 0 ? { pauseAfterMs: pauseMs } : {}),
    });
    return true;
  };
  const ask = (drill: Drill, phase: string, salt: number): void => {
    if (segments.length + 2 > MAX_LESSON_SEGMENTS - 6) return;
    const cue = takeCue(drill.cues, used, salt);
    if (!cue) return;
    const answerPhase = phase === "practice" ? "answer" : phase === "chunk" ? "chunk" : phase;
    push({ kind: "drill", phase, language: context.nativeLanguage, text: cue, delivery: "curious" }, ANSWER_PAUSE_MS);
    push({
      kind: "drill",
      phase: answerPhase,
      language: context.targetLanguage,
      text: drill.answer,
      translation: meaningOf(drill.translation),
      ...(drill.transliteration ? { transliteration: drill.transliteration } : {}),
      delivery: "clear",
    });
  };

  const targetLabel = languageById[context.targetLanguage].label;
  const teacherName = normalizeSpeakerNames(source.speakerNames).teacher;
  push({ kind: "narration", phase: "intro", language: context.nativeLanguage, text: introFor(context, targetLabel), delivery: "warm" });
  (context.priorReviews ?? []).slice(0, 2).forEach((review, index) => {
    ask({
      kind: "phrase",
      answer: review.text,
      translation: review.translation,
      cues: produceCues(review.translation),
    }, "warmup", index + 1);
  });
  push({ kind: "narration", phase: "hook", language: context.nativeLanguage, text: "Listen once, then we'll build it up and try it in a few places.", delivery: "warm" });
  push({
    kind: "example",
    phase: "hook",
    language: context.targetLanguage,
    text: core,
    translation: meaning,
    ...(context.transliteration ? { transliteration: context.transliteration } : {}),
    delivery: "clear",
  });
  push({ kind: "explanation", phase: "hook", language: context.nativeLanguage, text: gloss(core, meaning, context.targetLanguage), delivery: "clear" });
  if (note && !same(note, meaning) && !same(note, core)) {
    push({ kind: "explanation", phase: "note", language: context.nativeLanguage, text: note, delivery: "clear" });
    push({ kind: "explanation", phase: "note", language: context.nativeLanguage, text: "We'll practice the natural sentence, not the word-for-word version.", delivery: "clear" });
  }
  if (chunks.length > 0) {
    push({ kind: "narration", phase: "chunk", language: context.nativeLanguage, text: "We'll take it in pieces, starting from the end.", delivery: "warm" });
  } else {
    const formal = (context.alternatives ?? []).find((item) => /formal/i.test(item.label) && !same(item.text, core) && !isLiteral(item.text, note));
    push({
      kind: "narration",
      phase: "register",
      language: context.nativeLanguage,
      text: formal
        ? `With a friend, the line you just heard is enough. When you want to sound more formal, use the other wording.`
        : "The same sentence works with a friend and in a shop. You don't need a different verb for that.",
      delivery: "clear",
    });
    if (formal) {
      push({
        kind: "example",
        phase: "register",
        language: context.targetLanguage,
        text: formal.text,
        translation: `${meaning}, formally`,
        ...(formal.transliteration ? { transliteration: formal.transliteration } : {}),
        delivery: "clear",
      });
      push({ kind: "explanation", phase: "register", language: context.nativeLanguage, text: gloss(formal.text, `${meaning}, formally`, context.targetLanguage), delivery: "clear" });
    }
  }

  const reviewable = drills.flatMap((drill, index) => drill.kind === "chunk" ? [] : [index]);
  const slots = scheduleReviewSlots(reviewable.length, limits.reviews);
  const after = new Map<number, number[]>();
  for (const slot of slots) {
    const source = reviewable[slot.item];
    const boundary = reviewable[slot.afterItem];
    if (source === undefined || boundary === undefined) continue;
    after.set(boundary, [...(after.get(boundary) ?? []), source]);
  }
  drills.forEach((drill, index) => {
    if (drill.setup) {
      push({ kind: "narration", phase: drill.kind, language: context.nativeLanguage, text: drill.setup, delivery: "warm" });
    }
    if (drill.kind === "chunk") {
      push({ kind: "example", phase: "chunk", language: context.targetLanguage, text: drill.answer, translation: meaningOf(drill.translation), delivery: "clear" });
      push({ kind: "explanation", phase: "chunk", language: context.nativeLanguage, text: gloss(drill.answer, drill.translation, context.targetLanguage), delivery: "clear" });
    }
    const phase = drill.kind === "roleplay" ? "roleplay" : drill.kind === "chunk" ? "chunk" : "practice";
    ask(drill, phase, drill.kind === "swap" ? 0 : index);
    for (const earlier of after.get(index) ?? []) {
      const item = drills[earlier];
      if (item && item.kind !== "chunk") ask(item, "review", index + earlier + 3);
    }
  });

  push({
    kind: "recap",
    phase: "summary",
    language: context.nativeLanguage,
    text: `The line to keep is the one for "${meaning}". You can change a piece of it, and you can use it when someone asks what you need.`,
    delivery: "clear",
  });
  push({ kind: "recap", phase: "summary", language: context.targetLanguage, text: core, translation: meaning, delivery: "clear" });
  const quick = [
    drills.find((drill) => drill.kind === "phrase"),
    drills.find((drill) => drill.kind === "swap"),
    drills.find((drill) => drill.kind === "situation"),
  ].filter((drill): drill is Drill => Boolean(drill));
  quick.slice(0, 3).forEach((drill, index) => ask({
    ...drill,
    cues: produceCues(drill.translation).map((cue) => `Quick check. ${cue}`),
  }, "review", index));
  push({ kind: "recap", phase: "closing", language: context.nativeLanguage, text: "Nice work. The next time you need this, say the whole sentence out loud. That's how it sticks.", delivery: "praise" });

  if (segments.length < 8 || segments.some((segment) => segment.speaker !== "teacher")) return null;
  const title = clip(textOf(source.title) || `Saying: ${meaning}`, 90);
  const topic = clip(textOf(source.topic) || meaning, 160);
  const summary = clip(textOf(source.summary) || `Practice how to say "${meaning}" and a few variations.`, 280);
  if (title.length < 3 || topic.length < 3 || summary.length < 5) return null;
  return {
    title,
    topic,
    ruleId: context.phraseId,
    summary,
    speakerNames: normalizeSpeakerNames({ teacher: teacherName }),
    segments,
  };
}

