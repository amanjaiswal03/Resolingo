import { describe, expect, it } from "vitest";
import { phrasesToRemember, reviewItemId, selectDueReviews, touchReview, type ReviewItem } from "./review.js";

const now = Date.parse("2026-11-15T12:00:00.000Z");
const names = { teacher: "Mira", speakerA: "Lukas", speakerB: "Anna" };

function item(overrides: Partial<ReviewItem> & Pick<ReviewItem, "text" | "translation" | "dueAt">): ReviewItem {
  return {
    id: reviewItemId("de-DE", overrides.text),
    language: "de-DE",
    nativeLanguage: "en-US",
    speaker: "speakerA",
    strength: 1,
    intervalDays: 1,
    lastSeen: new Date(now).toISOString(),
    ...overrides,
  };
}

describe("cross-lesson reviews", () => {
  it("starts at one day and doubles the gap after each lesson", () => {
    const first = touchReview(undefined, {
      text: "Danke.",
      translation: "Thanks.",
      language: "de-DE",
      nativeLanguage: "en-US",
      speaker: "speakerA",
    }, now);
    expect(first.strength).toBe(1);
    expect(first.intervalDays).toBe(1);
    expect(Date.parse(first.dueAt) - now).toBe(86_400_000);
    const second = touchReview(first, {
      text: "Danke.",
      translation: "Thanks.",
      language: "de-DE",
      nativeLanguage: "en-US",
      speaker: "speakerA",
    }, now + 86_400_000);
    expect(second.strength).toBe(2);
    expect(second.intervalDays).toBe(2);
    expect(reviewItemId("de-DE", "Danke.")).toBe(reviewItemId("de-DE", "danke"));
    expect(reviewItemId("ja-JP", "駅はどこですか。")).toBe(reviewItemId("ja-JP", "駅はどこですか"));
    expect(reviewItemId("ja-JP", "駅はどこですか")).not.toBe(reviewItemId("ja-JP", "駅 は ど こ で す か"));
  });

  it("picks the most overdue items and ignores other languages and future cards", () => {
    const due = item({ text: "Danke.", translation: "Thanks.", dueAt: new Date(now - 86_400_000).toISOString(), strength: 2 });
    const older = item({ text: "Bitte.", translation: "You're welcome.", dueAt: new Date(now - 3 * 86_400_000).toISOString(), strength: 4 });
    const later = item({ text: "Geradeaus.", translation: "Straight ahead.", dueAt: new Date(now + 86_400_000).toISOString() });
    const other = item({ text: "Merci.", translation: "Thanks.", dueAt: new Date(now - 86_400_000).toISOString(), language: "fr-FR" });
    const selected = selectDueReviews([due, later, other, older], now, "de-DE", "en-US", 2);
    expect(selected.map((review) => review.text)).toEqual(["Bitte.", "Danke."]);
    expect(selectDueReviews([due, older], now, "de-DE", "en-US", 0)).toEqual([]);
  });

  it("remembers drilled phrases once, and skips names and dialogue-only lines", () => {
    const phrases = phrasesToRemember([
      { id: "1", kind: "dialogue", speaker: "speakerA", language: "de-DE", text: "Anna!", translation: "Anna!", phase: "dialogue", delivery: "warm" },
      { id: "2", kind: "drill", speaker: "teacher", language: "en-US", text: "How would you say thanks?", phase: "recall", delivery: "curious", pauseAfterMs: 5000 },
      { id: "3", kind: "drill", speaker: "speakerA", language: "de-DE", text: "Danke.", translation: "Thanks.", phase: "answer", delivery: "clear" },
      { id: "4", kind: "drill", speaker: "speakerA", language: "de-DE", text: "Danke.", translation: "Thanks.", phase: "review", delivery: "clear" },
      { id: "5", kind: "drill", speaker: "speakerB", language: "de-DE", text: "Wo ist das Hotel?", translation: "Where is the hotel?", phase: "recombine", delivery: "clear" },
    ], names, "de-DE");
    expect(phrases.map((phrase) => phrase.text)).toEqual(["Danke.", "Wo ist das Hotel?"]);
  });
});
