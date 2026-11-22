import { brandDeep, contrastRatio, lightColors } from "@/theme/colors";
import type { Theme } from "@/theme/tokens";
import { MASTERY_LEVELS, type MasteryLevel } from "./model";

/** One fill per strength level. They step in lightness as well as hue. */
export function levelColor(theme: Theme, level: MasteryLevel): string {
  const light = theme.background === lightColors.background;
  return [theme.border, theme.amber, theme.sky, theme.brand, light ? brandDeep : theme.mint][level]!;
}

/** Navy or white, whichever reads better on the level's fill. */
export function levelInk(theme: Theme, level: MasteryLevel): string {
  const fill = levelColor(theme, level);
  if (level === 0) return theme.text;
  return contrastRatio(theme.navy, fill) >= contrastRatio("#FFFFFF", fill) ? theme.navy : "#FFFFFF";
}

export const levelName = (level: MasteryLevel) => MASTERY_LEVELS[level];
