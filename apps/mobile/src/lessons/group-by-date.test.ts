import { describe, expect, it } from "vitest";
import { groupLessonsByDate, lessonDateLabel } from "./group-by-date";

const lesson = (id: string, quotaDate: string, createdAt: string) => ({ id, quotaDate, createdAt });

describe("lesson date groups", () => {
  it("names today and yesterday, then a weekday", () => {
    expect(lessonDateLabel("2026-11-19", "2026-11-19", "en-US")).toBe("Today");
    expect(lessonDateLabel("2026-11-18", "2026-11-19", "en-US")).toBe("Yesterday");
    expect(lessonDateLabel("2026-11-16", "2026-11-19", "en-US")).toBe("Monday, November 16");
    expect(lessonDateLabel("2025-12-01", "2026-11-19", "en-US")).toBe("Monday, December 1, 2025");
  });

  it("puts the newest day first and the newest lesson first inside it", () => {
    const groups = groupLessonsByDate([
      lesson("older", "2026-11-18", "2026-11-18T09:00:00.000Z"),
      lesson("later", "2026-11-19", "2026-11-19T15:00:00.000Z"),
      lesson("earlier-today", "2026-11-19", "2026-11-19T08:00:00.000Z"),
    ], "2026-11-19", "en-US");
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday"]);
    expect(groups[0]?.lessons.map((item) => item.id)).toEqual(["later", "earlier-today"]);
    expect(groups[1]?.lessons.map((item) => item.id)).toEqual(["older"]);
  });
});
