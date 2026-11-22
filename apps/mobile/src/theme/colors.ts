import type { LessonType } from "@resolingo/shared";

/**
 * Brand teal is #0F9D8A. Buttons and small text use a darker shade so white
 * or the ink color meets WCAG AA (4.5:1) for normal text.
 * Coral and amber stay warning and caution colors. Success green sits well
 * away from teal on the color wheel.
 */
export const brand = "#0F9D8A";
export const brandPressed = "#0B7A6B";
export const brandDeep = "#085E53";

const shared = {
  brand,
  /** Button fill. Darkened from the brand so white labels pass AA. */
  primaryFill: brandPressed,
  primaryPressed: brandDeep,
  onPrimary: "#FFFFFF",
  /** Text and icons on the navy snackbar and other dark chrome. */
  onDark: "#5DDEC8",
  coral: "#FF775F",
  amber: "#FFC857",
  /** Phrase lessons. Not a warning color. */
  sky: "#8EB7F5",
  navy: "#08152F",
  successFill: "#B5EB78",
} as const;

export const lightColors = {
  ...shared,
  background: "#F8F7F3",
  surface: "#FFFFFF",
  surfaceMuted: "#ECEEF2",
  text: "#101A30",
  textMuted: "#667085",
  border: "#DDE1E8",
  /** Links, tabs, and other small text on light surfaces. */
  primary: brandPressed,
  primaryTint: "#DDF3EF",
  success: "#178033",
  danger: "#BA1A1A",
} as const;

export const darkColors = {
  ...shared,
  background: "#071126",
  surface: "#101E39",
  surfaceMuted: "#182947",
  text: "#F5F7FB",
  textMuted: "#AEBBD0",
  border: "#2A3B59",
  /** Lighter teal so links and tabs stay readable on navy. */
  primary: "#5DDEC8",
  primaryTint: "#143F38",
  success: "#8FE07A",
  danger: "#FFB4AB",
} as const;

export type Palette = typeof lightColors;

export function lessonAccent(colors: { brand: string; successFill: string; sky: string }, type: LessonType): string {
  if (type === "grammar") return colors.successFill;
  if (type === "phrase") return colors.sky;
  return colors.brand;
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function hueDegrees(hex: string): number {
  const [redByte, greenByte, blueByte] = channels(hex);
  const red = redByte / 255;
  const green = greenByte / 255;
  const blue = blueByte / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return 0;
  const sector = max === red ? ((green - blue) / delta) % 6
    : max === green ? (blue - red) / delta + 2
      : (red - green) / delta + 4;
  return sector * 60;
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex);
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function channels(hex: string): [number, number, number] {
  const value = hex.slice(1);
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}
