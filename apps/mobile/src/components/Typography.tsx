import type { PropsWithChildren } from "react";
import { Text, type TextProps } from "react-native";
import { useTheme } from "@/theme/tokens";

export function Title({ children, style, ...props }: PropsWithChildren<TextProps>) {
  const theme = useTheme();
  return <Text maxFontSizeMultiplier={1.5} style={[{ color: theme.text, fontSize: 32, lineHeight: 38, fontWeight: "800", letterSpacing: -0.6 }, style]} {...props}>{children}</Text>;
}

export function Heading({ children, style, ...props }: PropsWithChildren<TextProps>) {
  const theme = useTheme();
  return <Text maxFontSizeMultiplier={1.5} style={[{ color: theme.text, fontSize: 21, lineHeight: 27, fontWeight: "700" }, style]} {...props}>{children}</Text>;
}

export function Body({ children, muted = false, style, ...props }: PropsWithChildren<TextProps & { muted?: boolean }>) {
  const theme = useTheme();
  return <Text maxFontSizeMultiplier={1.7} style={[{ color: muted ? theme.textMuted : theme.text, fontSize: 16, lineHeight: 24 }, style]} {...props}>{children}</Text>;
}
