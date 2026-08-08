import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { localDate, nextReminderAt } from "./time.js";

describe("timezone helpers", () => {
  it("uses the user's local calendar date", () => {
    const now = DateTime.fromISO("2026-08-08T23:30:00Z");
    expect(localDate("Europe/Berlin", now)).toBe("2026-08-09");
  });

  it("advances reminders that already passed", () => {
    const now = DateTime.fromISO("2026-08-08T12:00:00Z");
    expect(nextReminderAt("Europe/Berlin", "09:00", now).toISOString()).toBe("2026-08-09T07:00:00.000Z");
  });
});
