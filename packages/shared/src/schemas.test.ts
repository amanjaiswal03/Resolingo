import { describe, expect, it } from "vitest";
import { CreateDailyLessonRequestSchema, languages } from "./index.js";

describe("shared contracts", () => {
  it("contains the canonical 32-language catalog", () => {
    expect(languages).toHaveLength(32);
    expect(new Set(languages.map((language) => language.id)).size).toBe(32);
  });

  it("rejects a non-UUID idempotency key", () => {
    expect(CreateDailyLessonRequestSchema.safeParse({ type: "grammar", idempotencyKey: "repeat" }).success).toBe(false);
  });
});
