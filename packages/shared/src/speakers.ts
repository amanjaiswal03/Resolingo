export const DEFAULT_SPEAKER_NAMES = {
  teacher: "Mira",
  speakerA: "Lukas",
  speakerB: "Anna",
} as const;

export type SpeakerNames = { teacher: string; speakerA: string; speakerB: string };

const ALIAS = /^[A-Za-z][A-Za-z]{0,23}$/;

function alias(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ALIAS.test(trimmed) ? trimmed : null;
}

function same(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

/** One-word Latin names Gemini can use as speaker aliases. Missing or colliding names fall back. */
export function normalizeSpeakerNames(value: unknown): SpeakerNames {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  let teacher = alias(record.teacher) ?? DEFAULT_SPEAKER_NAMES.teacher;
  let speakerA = alias(record.speakerA) ?? DEFAULT_SPEAKER_NAMES.speakerA;
  let speakerB = alias(record.speakerB) ?? DEFAULT_SPEAKER_NAMES.speakerB;
  if (same(speakerA, speakerB)) speakerB = same(speakerB, DEFAULT_SPEAKER_NAMES.speakerB) ? "Elena" : DEFAULT_SPEAKER_NAMES.speakerB;
  if (same(teacher, speakerA) || same(teacher, speakerB)) {
    teacher = same(teacher, DEFAULT_SPEAKER_NAMES.teacher) ? "Nora" : DEFAULT_SPEAKER_NAMES.teacher;
  }
  if (same(teacher, speakerA) || same(teacher, speakerB)) teacher = "Nora";
  return { teacher, speakerA, speakerB };
}

export function speakerLabel(speaker: "teacher" | "speakerA" | "speakerB", names?: SpeakerNames): string {
  const resolved = names ?? DEFAULT_SPEAKER_NAMES;
  return resolved[speaker];
}

/** Replace leftover Speaker A / Speaker B labels with the names used in the voice config. */
export function dialogueText(text: string, names: SpeakerNames): string {
  return text
    .replace(/\bSpeaker A\b/g, names.speakerA)
    .replace(/\bSpeaker B\b/g, names.speakerB)
    .replace(/\bSpeakerA\b/g, names.speakerA)
    .replace(/\bSpeakerB\b/g, names.speakerB);
}
