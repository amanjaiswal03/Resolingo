import { useColorScheme } from "react-native";

const shared = {
  coral: "#FF775F",
  amber: "#FFC857",
  mint: "#66E0C2",
  navy: "#08152F",
  radiusSm: 12,
  radiusMd: 20,
  radiusLg: 30,
  spaceXs: 6,
  spaceSm: 12,
  spaceMd: 20,
  spaceLg: 32,
} as const;

const light = {
  ...shared,
  background: "#F8F7F3",
  surface: "#FFFFFF",
  surfaceMuted: "#ECEEF2",
  text: "#101A30",
  textMuted: "#667085",
  border: "#DDE1E8",
  primary: "#E95442",
  onPrimary: "#FFFFFF",
  danger: "#BA1A1A",
};

const dark = {
  ...shared,
  background: "#071126",
  surface: "#101E39",
  surfaceMuted: "#182947",
  text: "#F5F7FB",
  textMuted: "#AEBBD0",
  border: "#2A3B59",
  primary: "#FF8B75",
  onPrimary: "#2C0803",
  danger: "#FFB4AB",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
