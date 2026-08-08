import { describe, expect, it } from "vitest";
import { quotaUsed, reserveLesson } from "./quota.js";

describe("daily quota", () => {
  it("counts ready lessons plus unique active reservations", () => {
    expect(quotaUsed(1, ["a", "a", "b"])).toBe(3);
  });

  it("keeps duplicate requests idempotent", () => {
    expect(reserveLesson(2, ["same"], "same", 3)).toEqual(["same"]);
  });

  it("rejects a fourth reserved or ready lesson", () => {
    expect(() => reserveLesson(2, ["active"], "fourth", 3)).toThrow("DAILY_LIMIT_REACHED");
  });
});
