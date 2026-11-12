import { describe, expect, it } from "vitest";
import { activeLessonBlocks, CreateDailyLessonRequestSchema, GeneratedLessonSchema, isStaleUnenqueuedLesson, languageById, languages, LessonSegmentSchema, STALE_UNENQUEUED_AFTER_MS } from "./index.js";

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

  it("accepts 18 to 30 segments and rejects a short or oversized lesson", () => {
    const segment = (index: number) => ({
      id: `s${index}`,
      kind: "narration" as const,
      speaker: "teacher" as const,
      language: "en-US" as const,
      text: "Hello.",
    });
    const lesson = (count: number) => ({
      title: "Cafe greetings today",
      topic: "Ordering coffee",
      summary: "Practice a longer cafe conversation.",
      segments: Array.from({ length: count }, (_, index) => segment(index)),
    });
    expect(GeneratedLessonSchema.safeParse(lesson(17)).success).toBe(false);
    expect(GeneratedLessonSchema.safeParse(lesson(18)).success).toBe(true);
    expect(GeneratedLessonSchema.safeParse(lesson(30)).success).toBe(true);
    expect(GeneratedLessonSchema.safeParse(lesson(31)).success).toBe(false);
  });

  it("rejects a non-UUID idempotency key", () => {
    expect(CreateDailyLessonRequestSchema.safeParse({ type: "grammar", idempotencyKey: "repeat" }).success).toBe(false);
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
