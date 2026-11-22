import { useColorScheme } from "react-native";
import { darkColors, lightColors } from "./colors";

const shared = {
  radiusSm: 12,
  radiusMd: 20,
  radiusLg: 30,
  spaceXs: 6,
  spaceSm: 12,
  spaceMd: 20,
  spaceLg: 32,
} as const;

const light = { ...shared, ...lightColors };
const dark = { ...shared, ...darkColors };

type ThemeValue<T> = T extends number ? number : string;
export type Theme = { [K in keyof typeof light]: ThemeValue<(typeof light)[K]> };

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
