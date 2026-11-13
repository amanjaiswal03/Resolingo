import { describe, expect, it } from "vitest";
import { DAILY_LIMIT, DELETE_ACCOUNT_TIMEOUT_SECONDS } from "./config.js";
import { dailyReservationLimit, quotaUsed, reserveLesson, withoutReservation } from "./quota.js";

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

  it("skips the daily cap only for an explicit unlimited flag and still records the slot", () => {
    expect(dailyReservationLimit(true, DAILY_LIMIT)).toBe(Number.POSITIVE_INFINITY);
    expect(dailyReservationLimit(false, DAILY_LIMIT)).toBe(DAILY_LIMIT);
    expect(dailyReservationLimit(undefined, DAILY_LIMIT)).toBe(DAILY_LIMIT);
    expect(dailyReservationLimit("true", DAILY_LIMIT)).toBe(DAILY_LIMIT);
    expect(reserveLesson(3, ["a", "b"], "fourth", dailyReservationLimit(true, DAILY_LIMIT))).toEqual(["a", "b", "fourth"]);
  });

  it("keeps the three-lesson cap and gives account deletion enough time", () => {
    expect(DAILY_LIMIT).toBe(3);
    expect(DELETE_ACCOUNT_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(540);
  });

  it("drops one reservation without touching the others", () => {
    expect(withoutReservation(["a", 2, "b"], "a")).toEqual(["b"]);
    expect(withoutReservation(undefined, "a")).toEqual([]);
  });
});
