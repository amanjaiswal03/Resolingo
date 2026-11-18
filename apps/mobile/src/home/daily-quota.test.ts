import { describe, expect, it } from "vitest";
import { dailyCapBlocksStart, dailyQuotaLabel, lessonsReadyToday } from "./daily-quota";

describe("home daily quota", () => {
  it("shows used of three and blocks another start at the cap", () => {
    expect(dailyQuotaLabel(1, false)).toBe("1/3 lessons ready today · 2 remaining");
    expect(dailyCapBlocksStart(3, false)).toBe(true);
    expect(dailyCapBlocksStart(2, false)).toBe(false);
  });

  it("shows Unlimited and leaves the cap unlocked", () => {
    expect(dailyQuotaLabel(3, true)).toBe("Unlimited");
    expect(dailyCapBlocksStart(3, true)).toBe(false);
  });

  it("keeps a deleted lesson in today's count", () => {
    expect(lessonsReadyToday(2, 1, 3)).toBe(3);
    expect(lessonsReadyToday(3, 0, 0)).toBe(3);
    expect(lessonsReadyToday(1, 0, 3)).toBe(3);
  });
});
