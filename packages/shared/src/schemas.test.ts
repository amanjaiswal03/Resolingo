import { describe, expect, it } from "vitest";
import { activeLessonBlocks, CreateDailyLessonRequestSchema, CreatePhraseLessonRequestSchema, InitializeProfileRequestSchema, isStaleUnenqueuedLesson, languageById, languages, LessonSegmentSchema, MAX_PHRASE_AUDIO_BYTES, phraseAudioByteLength, STALE_UNENQUEUED_AFTER_MS, TranslatePhraseRequestSchema } from "./index.js";

describe("shared contracts", () => {
  it("contains the canonical 32-language catalog", () => {
    expect(languages).toHaveLength(32);
    expect(new Set(languages.map((language) => language.id)).size).toBe(32);
  });

  it("maps Arabic Cloud TTS to ar-XA and defaults a missing delivery hint", () => {
    expect(languageById["ar-EG"].googleTtsLanguageCode).toBe("ar-XA");
    const segment = LessonSegmentSchema.parse({
      id: "s1",
      kind: "narration",
      speaker: "teacher",
      language: "ar-EG",
      text: "مرحبا",
    });
    expect(segment.delivery).toBe("warm");
  });

  it("rejects a non-UUID idempotency key", () => {
    expect(CreateDailyLessonRequestSchema.safeParse({ type: "grammar", idempotencyKey: "repeat" }).success).toBe(false);
  });

  it("keeps phrase lessons off the daily topic buttons and accepts a text lookup", () => {
    expect(CreateDailyLessonRequestSchema.safeParse({ type: "phrase", idempotencyKey: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff" }).success).toBe(false);
    expect(TranslatePhraseRequestSchema.safeParse({ text: "I need shoes", audioBase64: "AAAA" }).success).toBe(false);
    expect(TranslatePhraseRequestSchema.safeParse({ text: "x".repeat(281) }).success).toBe(false);
    expect(TranslatePhraseRequestSchema.safeParse({ text: "I need to buy a pair of shoes" }).success).toBe(true);
    const spoken = Buffer.alloc(900, 7).toString("base64");
    expect(phraseAudioByteLength(spoken)).toBe(900);
    expect(TranslatePhraseRequestSchema.safeParse({
      mode: "transcribe",
      audioBase64: spoken,
      mimeType: "audio/m4a",
      durationMs: 2_000,
    }).success).toBe(true);
    expect(TranslatePhraseRequestSchema.safeParse({
      mode: "transcribe",
      audioBase64: spoken,
      mimeType: "audio/webm",
      durationMs: 2_000,
    }).success).toBe(false);
    const oversized = Buffer.alloc(MAX_PHRASE_AUDIO_BYTES + 1, 1).toString("base64");
    const tooBig = TranslatePhraseRequestSchema.safeParse({
      mode: "transcribe",
      audioBase64: oversized,
      mimeType: "audio/mp4",
      durationMs: 2_000,
    });
    expect(tooBig.success).toBe(false);
    if (!tooBig.success) expect(tooBig.error.issues.some((issue) => issue.message === "That recording is too long.")).toBe(true);
    const silent = TranslatePhraseRequestSchema.safeParse({
      mode: "transcribe",
      audioBase64: Buffer.alloc(20, 1).toString("base64"),
      mimeType: "audio/m4a",
      durationMs: 2_000,
    });
    expect(silent.success).toBe(false);
    if (!silent.success) expect(silent.error.issues.some((issue) => issue.message === "Didn't catch that. Try again.")).toBe(true);
    expect(CreatePhraseLessonRequestSchema.safeParse({
      phraseId: "phrase_ab12cd34",
      idempotencyKey: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    }).success).toBe(true);
  });

  it("drops unlimitedLessons from profile initialization so clients cannot grant it", () => {
    const parsed = InitializeProfileRequestSchema.safeParse({
      nickname: "Ada",
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "A1",
      timezone: "Europe/Berlin",
      telemetryConsent: false,
      reminderEnabled: true,
      reminderTime: "18:00",
      unlimitedLessons: true,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("unlimitedLessons");
  });
});

describe("unenqueued lesson lock", () => {
  const nowMs = Date.parse("2026-11-04T12:00:00Z");

  it("treats a queued lesson with no accepted task as stale after two minutes", () => {
    expect(isStaleUnenqueuedLesson({
      status: "queued",
      enqueuePending: true,
      updatedAtMs: nowMs - STALE_UNENQUEUED_AFTER_MS,
      nowMs,
    })).toBe(true);
  });

  it("keeps a freshly queued lesson and an accepted task locked", () => {
    expect(activeLessonBlocks({
      status: "queued",
      enqueuePending: true,
      updatedAtMs: nowMs - 30_000,
      nowMs,
    })).toBe(true);
    expect(activeLessonBlocks({
      status: "queued",
      enqueuePending: false,
      updatedAtMs: nowMs - 60 * 60 * 1000,
      nowMs,
    })).toBe(true);
    expect(activeLessonBlocks({
      status: "generating_content",
      enqueuePending: true,
      updatedAtMs: nowMs - 60 * 60 * 1000,
      nowMs,
    })).toBe(true);
  });

  it("does not lock a failed lesson or a stale unenqueued lesson", () => {
    expect(activeLessonBlocks({ status: "failed", enqueuePending: false, updatedAtMs: nowMs, nowMs })).toBe(false);
    expect(activeLessonBlocks({
      status: "queued",
      enqueuePending: true,
      updatedAtMs: nowMs - STALE_UNENQUEUED_AFTER_MS - 1,
      nowMs,
    })).toBe(false);
  });
});
