import { describe, expect, it } from "vitest";
import { brand, contrastRatio, darkColors, hueDegrees, lessonAccent, lightColors } from "./colors";

const AA = 4.5;

describe("deep teal theme", () => {
  it("uses the specified brand teal and keeps orange for warnings", () => {
    expect(brand).toBe("#0F9D8A");
    expect(lightColors.brand).toBe("#0F9D8A");
    expect(darkColors.brand).toBe("#0F9D8A");
    expect(lightColors.coral).toBe("#FF775F");
    expect(lightColors.amber).toBe("#FFC857");
    expect(lightColors.primaryFill).not.toBe(lightColors.coral);
    expect(lightColors.primaryFill).not.toBe(lightColors.amber);
  });

  it("keeps white button text at WCAG AA in both modes", () => {
    for (const colors of [lightColors, darkColors]) {
      expect(contrastRatio(colors.onPrimary, colors.primaryFill)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(colors.onPrimary, colors.primaryPressed)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("keeps brand text readable on the page and on the navy snackbar", () => {
    expect(contrastRatio(lightColors.primary, lightColors.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(lightColors.primary, lightColors.background)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(darkColors.primary, darkColors.background)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(darkColors.primary, darkColors.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(lightColors.onDark, lightColors.navy)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(darkColors.onDark, darkColors.navy)).toBeGreaterThanOrEqual(AA);
  });

  it("keeps lesson cards and success fills readable, and success apart from teal", () => {
    expect(contrastRatio(lightColors.navy, lightColors.brand)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(lightColors.navy, lightColors.successFill)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(lightColors.navy, lightColors.sky)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(lightColors.navy, lightColors.coral)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(lightColors.navy, lightColors.amber)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(lightColors.success, lightColors.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(darkColors.success, darkColors.background)).toBeGreaterThanOrEqual(AA);
    const apart = Math.abs(hueDegrees(lightColors.brand) - hueDegrees(lightColors.successFill));
    expect(Math.min(apart, 360 - apart)).toBeGreaterThanOrEqual(60);
  });

  it("colors conversation with teal, grammar with green, and phrases without a warning color", () => {
    expect(lessonAccent(lightColors, "conversation")).toBe(lightColors.brand);
    expect(lessonAccent(lightColors, "grammar")).toBe(lightColors.successFill);
    expect(lessonAccent(lightColors, "phrase")).toBe(lightColors.sky);
  });
});
