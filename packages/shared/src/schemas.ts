import { z } from "zod";
import { ConversationSkillSchema } from "./conversation-skills.js";
import { LanguageIdSchema } from "./languages.js";
import { normalizeSpeakerNames } from "./speakers.js";

export const LessonTypeSchema = z.enum(["conversation", "grammar", "phrase"]);
export type LessonType = z.infer<typeof LessonTypeSchema>;

export const LessonStatusSchema = z.enum([
  "queued",
  "generating_content",
  "synthesizing_audio",
  "ready",
  "failed",
]);
export type LessonStatus = z.infer<typeof LessonStatusSchema>;

export const CefrLevelSchema = z.enum(["A1", "A2", "B1", "B2", "C1"]);
export type CefrLevel = z.infer<typeof CefrLevelSchema>;

export const SegmentKindSchema = z.enum([
  "narration", "dialogue", "explanation", "example", "drill", "recap",
]);

export const DeliverySchema = z.enum(["warm", "praise", "gentle", "curious", "clear", "playful"]);
export type Delivery = z.infer<typeof DeliverySchema>;

/** Upper bound for one generated lesson, including spaced recalls and a short review warm-up. */
export const MAX_LESSON_SEGMENTS = 120;

export const LessonSegmentSchema = z.object({
  id: z.string().min(1),
  kind: SegmentKindSchema,
  speaker: z.enum(["teacher", "speakerA", "speakerB"]),
  /** How this line should be spoken. Missing values from older lessons stay warm. */
  delivery: DeliverySchema.default("warm"),
  language: LanguageIdSchema,
  text: z.string().min(1).max(900),
  translation: z.string().max(900).optional(),
  transliteration: z.string().max(900).optional(),
  /** Silence after this clip so the learner can answer aloud. The player does not add a second wait. */
  pauseAfterMs: z.number().int().min(0).max(20_000).optional(),
  /** Lesson section, kept as a string so an unexpected value cannot fail generation. */
  phase: z.string().min(1).max(24).optional(),
  audioPath: z.string().min(1).optional(),
  audioUrl: z.string().url().optional(),
  durationMs: z.number().int().positive().optional(),
});
export type LessonSegment = z.infer<typeof LessonSegmentSchema>;

export const SpeakerNamesSchema = z.object({
  teacher: z.string().min(1).max(24),
  speakerA: z.string().min(1).max(24),
  speakerB: z.string().min(1).max(24),
});

/** Always yields three distinct, speakable aliases, including for lessons saved before names existed. */
export const SpeakerNamesField = z.preprocess((value) => normalizeSpeakerNames(value), SpeakerNamesSchema);

export const GeneratedLessonSchema = z.object({
  title: z.string().min(3).max(90),
  topic: z.string().min(3).max(160),
  conversationSkill: ConversationSkillSchema.optional(),
  /** Catalog id for a grammar lesson, so later reviews can name the rule. */
  ruleId: z.string().min(1).max(40).optional(),
  summary: z.string().min(5).max(280),
  speakerNames: SpeakerNamesField,
  segments: z.array(LessonSegmentSchema.omit({ audioPath: true, audioUrl: true, durationMs: true })).min(8).max(MAX_LESSON_SEGMENTS),
});
export type GeneratedLesson = z.infer<typeof GeneratedLessonSchema>;

export const AudioManifestSchema = z.object({
  totalDurationMs: z.number().int().nonnegative(),
  segmentCount: z.number().int().nonnegative(),
  completedAt: z.string().datetime(),
});
export type AudioManifest = z.infer<typeof AudioManifestSchema>;

export const UserProfileSchema = z.object({
  uid: z.string().min(1),
  nickname: z.string().trim().min(1).max(40),
  nativeLanguage: LanguageIdSchema,
  targetLanguage: LanguageIdSchema,
  level: CefrLevelSchema,
  timezone: z.string().min(1).max(80),
  onboardingComplete: z.boolean(),
  telemetryConsent: z.boolean(),
  reminderEnabled: z.boolean(),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** Admin SDK only. Absent or false keeps the daily lesson cap. */
  unlimitedLessons: z.boolean().optional(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const LessonSchema = z.object({
  id: z.string().min(1),
  type: LessonTypeSchema,
  conversationSkill: ConversationSkillSchema.optional(),
  nativeLanguage: LanguageIdSchema.optional(),
  targetLanguage: LanguageIdSchema.optional(),
  level: CefrLevelSchema.optional(),
  status: LessonStatusSchema,
  progress: z.number().int().min(0).max(100),
  quotaDate: z.string(),
  title: z.string().default("Preparing your lesson"),
  topic: z.string().default(""),
  ruleId: z.string().min(1).max(40).optional(),
  /** Set when the lesson was built from a saved "How would you say?" phrase. */
  phraseId: z.string().min(1).max(40).optional(),
  nativeText: z.string().min(1).max(280).optional(),
  translation: z.string().min(1).max(280).optional(),
  summary: z.string().default(""),
  speakerNames: SpeakerNamesField,
  segments: z.array(LessonSegmentSchema).default([]),
  manifest: AudioManifestSchema.optional(),
  failureCode: z.string().optional(),
  completed: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const InitializeProfileRequestSchema = UserProfileSchema.omit({
  uid: true,
  onboardingComplete: true,
  unlimitedLessons: true,
});
export const CreateDailyLessonRequestSchema = z.object({
  type: z.enum(["conversation", "grammar"]),
  idempotencyKey: z.string().uuid(),
});
export const PHRASE_AUDIO_MIME_TYPES = ["audio/m4a", "audio/mp4", "audio/aac", "audio/wav"] as const;
export const MAX_PHRASE_AUDIO_BYTES = 1_000_000;
export const MAX_PHRASE_AUDIO_SECONDS = 15;
const MIN_PHRASE_AUDIO_BYTES = 800;
const MIN_PHRASE_AUDIO_MS = 300;

/** Decoded size of a base64 payload, ignoring whitespace. */
export function phraseAudioByteLength(audioBase64: string): number {
  const cleaned = audioBase64.replace(/\s/gu, "");
  if (cleaned.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(cleaned) || cleaned.length % 4 !== 0) return Number.POSITIVE_INFINITY;
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.floor((cleaned.length * 3) / 4) - padding;
}

export const TranslatePhraseRequestSchema = z.object({
  mode: z.enum(["translate", "transcribe"]).default("translate"),
  text: z.string().trim().max(280).optional(),
  audioBase64: z.string().min(1).max(2_000_000).optional(),
  mimeType: z.string().optional(),
  durationMs: z.number().int().min(1).max(MAX_PHRASE_AUDIO_SECONDS * 1000, "Keep it under 15 seconds.").optional(),
}).strict().superRefine((value, context) => {
  if (value.audioBase64) {
    if (!value.mimeType || !(PHRASE_AUDIO_MIME_TYPES as readonly string[]).includes(value.mimeType)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "That recording format is not supported.", path: ["mimeType"] });
    }
    const bytes = phraseAudioByteLength(value.audioBase64);
    if (!Number.isFinite(bytes)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "That recording could not be read.", path: ["audioBase64"] });
    } else if (bytes > MAX_PHRASE_AUDIO_BYTES) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "That recording is too long.", path: ["audioBase64"] });
    } else if (bytes < MIN_PHRASE_AUDIO_BYTES || (value.durationMs !== undefined && value.durationMs < MIN_PHRASE_AUDIO_MS)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Didn't catch that. Try again.", path: ["audioBase64"] });
    }
    if (value.durationMs === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Keep it under 15 seconds.", path: ["durationMs"] });
    }
    return;
  }
  if (value.mode === "transcribe" || value.mimeType || value.durationMs !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Record a short sentence.", path: ["audioBase64"] });
    return;
  }
  const text = value.text ?? "";
  if (!text || !/[\p{L}]/u.test(text)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Type a sentence.", path: ["text"] });
  }
});
export const CreatePhraseLessonRequestSchema = z.object({
  phraseId: z.string().regex(/^phrase_[0-9a-f]{8}$/),
  idempotencyKey: z.string().uuid(),
});
export const PhraseAlternativeSchema = z.object({
  label: z.string().min(1).max(40),
  text: z.string().min(1).max(280),
  transliteration: z.string().max(280).optional(),
});
export const PhraseInputLanguageSchema = z.enum(["native", "target", "mixed", "unknown"]);
export const PhraseSchema = z.object({
  id: z.string().regex(/^phrase_[0-9a-f]{8}$/),
  nativeText: z.string().min(1).max(280),
  translation: z.string().min(1).max(280),
  transliteration: z.string().max(280).optional(),
  alternatives: z.array(PhraseAlternativeSchema).max(2).default([]),
  inputLanguage: PhraseInputLanguageSchema,
  note: z.string().max(280).optional(),
  audioPath: z.string().min(1).optional(),
  lessonId: z.string().min(1).optional(),
  targetLanguage: LanguageIdSchema,
  nativeLanguage: LanguageIdSchema,
  level: CefrLevelSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Phrase = z.infer<typeof PhraseSchema>;
export const LessonIdRequestSchema = z.object({ lessonId: z.string().min(1) });
export const RegisterPushDeviceRequestSchema = z.object({
  expoPushToken: z.string().min(1),
  nativePushToken: z.string().min(1).optional(),
  platform: z.enum(["ios", "android"]),
});
export const UpdateReminderRequestSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(80),
});
export const SetTelemetryConsentRequestSchema = z.object({ enabled: z.boolean() });

export const CallableErrorCodeSchema = z.enum([
  "unauthenticated", "invalid_argument", "profile_incomplete", "quota_exceeded",
  "job_in_progress", "not_found", "not_retryable", "provider_failure", "internal",
]);
export type CallableErrorCode = z.infer<typeof CallableErrorCodeSchema>;
