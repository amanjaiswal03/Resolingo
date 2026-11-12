import { describe, expect, it } from "vitest";
import { mapConcurrent } from "./concurrent.js";

describe("mapConcurrent", () => {
  it("preserves order and never runs more than the limit at once", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});
