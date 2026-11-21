import type { LanguageId } from "./languages.js";

/** Media time to leave after a prompt, before the lesson plays its example. */
export function speakingPauseMs(text: string, language: LanguageId): number {
  const content = text.replace(/\[\[\/?lang(?::[^\]]+)?\]\]/gu, "");
  const words = content.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
  const letters = Array.from(words.join("")).length;
  const length = /^(ja|zh|th)-/u.test(language) ? Math.ceil(letters / 2.5) : words.length;
  const sentences = content.split(/[.!?。！？]+[”’"']*/u).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
  if (sentences > 1) return Math.min(14_000, Math.max(9_000, length * 550 + 3_200));
  if (length <= 1) return letters >= 12 ? 4_200 : 3_500;
  if (length <= 4) return 5_000;
  return Math.min(12_000, 6_200 + (length - 5) * 550);
}

/** Extra wall time for the cue and for the learner to finish speaking. */
export function checkedSpeakingBonusMs(normalPauseMs: number): number {
  return normalPauseMs <= 4_200 ? 1_250 : normalPauseMs <= 5_000 ? 1_500 : 2_000;
}
