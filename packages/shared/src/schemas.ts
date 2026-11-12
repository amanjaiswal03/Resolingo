import { z } from "zod";
import { LanguageIdSchema } from "./languages.js";

export const LessonTypeSchema = z.enum(["conversation", "grammar"]);
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
  audioPath: z.string().min(1).optional(),
  audioUrl: z.string().url().optional(),
  durationMs: z.number().int().positive().optional(),
});
export type LessonSegment = z.infer<typeof LessonSegmentSchema>;

/** A generated lesson is about twice the previous 8–16 segment script. */
export const LESSON_SEGMENT_MIN = 18;
export const LESSON_SEGMENT_MAX = 30;

export const GeneratedLessonSchema = z.object({
  title: z.string().min(3).max(90),
  topic: z.string().min(3).max(160),
  summary: z.string().min(5).max(280),
  segments: z.array(LessonSegmentSchema.omit({ audioPath: true, audioUrl: true, durationMs: true })).min(LESSON_SEGMENT_MIN).max(LESSON_SEGMENT_MAX),
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
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const LessonSchema = z.object({
  id: z.string().min(1),
  type: LessonTypeSchema,
  status: LessonStatusSchema,
  progress: z.number().int().min(0).max(100),
  quotaDate: z.string(),
  title: z.string().default("Preparing your lesson"),
  topic: z.string().default(""),
  summary: z.string().default(""),
  segments: z.array(LessonSegmentSchema).default([]),
  manifest: AudioManifestSchema.optional(),
  failureCode: z.string().optional(),
  completed: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const InitializeProfileRequestSchema = UserProfileSchema.omit({ uid: true, onboardingComplete: true });
export const CreateDailyLessonRequestSchema = z.object({
  type: LessonTypeSchema,
  idempotencyKey: z.string().uuid(),
});
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
