import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import { useTheme } from "@/theme/tokens";

export function Button({ label, loading = false, variant = "primary", disabled, ...props }: PressableProps & {
  label: string;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const theme = useTheme();
  const color = variant === "primary" ? theme.onPrimary : variant === "danger" ? theme.surface : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      style={({ pressed }) => {
        const background = variant === "primary" ? (pressed ? theme.primaryPressed : theme.primaryFill)
          : variant === "danger" ? theme.danger
            : variant === "secondary" ? theme.surfaceMuted
              : "transparent";
        return [styles.button, { backgroundColor: background, borderColor: theme.border, opacity: disabled ? 0.45 : pressed && variant !== "primary" ? 0.75 : 1 }];
      }}
      {...props}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text maxFontSizeMultiplier={1.5} style={[styles.label, { color }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 18, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 16, fontWeight: "700" },
});
