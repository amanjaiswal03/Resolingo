export const voiceTiers = ["standard", "wavenet", "neural2", "chirp3"] as const;
export type VoiceTier = (typeof voiceTiers)[number];

const fallbacks: Record<VoiceTier, readonly VoiceTier[]> = {
  wavenet: ["wavenet", "standard"],
  standard: ["standard"],
  neural2: ["neural2", "wavenet", "standard"],
  chirp3: ["chirp3", "neural2", "wavenet", "standard"],
};

export function voiceTierFromEnv(value: string | undefined): VoiceTier {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "wavenet";
  if ((voiceTiers as readonly string[]).includes(normalized)) return normalized as VoiceTier;
  throw new Error(`TTS_VOICE_TIER_INVALID:${value}`);
}

export function voiceTierOf(name: string): VoiceTier | null {
  const lower = name.toLowerCase();
  if (lower.includes("chirp3")) return "chirp3";
  if (lower.includes("neural2")) return "neural2";
  if (lower.includes("wavenet")) return "wavenet";
  if (lower.includes("standard")) return "standard";
  return null;
}

export type ListedVoice = { name: string; gender: "FEMALE" | "MALE" | "NEUTRAL" };

export type RoleVoiceAssignment = { teacher: string; speakerA: string; speakerB: string };

function voicesForTier(voices: readonly ListedVoice[], tier: VoiceTier): ListedVoice[] {
  let single: ListedVoice[] = [];
  for (const candidate of fallbacks[tier]) {
    const matches = voices.filter((voice) => voiceTierOf(voice.name) === candidate).sort((left, right) => left.name.localeCompare(right.name));
    if (matches.length >= 2) return matches;
    if (!single.length && matches.length === 1) single = matches;
  }
  return single;
}

/**
 * Teacher and speaker B are female, and they are different voices when the
 * language has two. Speaker A is male. Alphabetical order is not gender.
 */
export function assignRoleVoices(voices: readonly ListedVoice[], tier: VoiceTier): RoleVoiceAssignment {
  const pool = voicesForTier(voices, tier);
  const females = pool.filter((voice) => voice.gender === "FEMALE");
  const males = pool.filter((voice) => voice.gender === "MALE");
  const teacher = females[0]?.name ?? pool[0]?.name ?? "";
  const speakerB = females.find((voice) => voice.name !== teacher)?.name ?? teacher;
  const speakerA = males[0]?.name ?? pool.find((voice) => voice.name !== teacher && voice.name !== speakerB)?.name ?? teacher;
  return { teacher, speakerA, speakerB };
}

export function selectVoices(names: readonly string[], tier: VoiceTier): { tier: VoiceTier | null; voices: string[] } {
  let single: { tier: VoiceTier; voices: string[] } | null = null;
  for (const candidate of fallbacks[tier]) {
    const matches = names.filter((name) => voiceTierOf(name) === candidate).sort((left, right) => left.localeCompare(right));
    if (matches.length >= 2) return { tier: candidate, voices: matches };
    if (!single && matches.length === 1) single = { tier: candidate, voices: matches };
  }
  return single ?? { tier: null, voices: [] };
}
