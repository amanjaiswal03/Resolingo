import { ActivityIndicator, StyleSheet, Text, type PressableProps } from "react-native";
import { PressableScale } from "./PressableScale";
import { useTheme } from "@/theme/tokens";

export function Button({ label, loading = false, variant = "primary", disabled, style: _style, ...props }: PressableProps & {
  label: string;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const theme = useTheme();
  const background = variant === "primary" ? theme.primaryFill
    : variant === "danger" ? theme.danger
      : variant === "secondary" ? theme.surfaceMuted
        : "transparent";
  const color = variant === "primary" ? theme.onPrimary : variant === "danger" ? theme.surface : theme.text;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      haptic={variant === "ghost" ? "none" : "light"}
      style={[styles.button, { backgroundColor: background, borderColor: theme.border, opacity: disabled ? 0.45 : 1 }]}
      {...props}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text maxFontSizeMultiplier={1.5} style={[styles.label, { color }]}>{label}</Text>}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 18, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 16, fontWeight: "700" },
});
