import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Button } from "./Button";
import { Body, Heading } from "./Typography";
import { useTheme } from "@/theme/tokens";

/** Shown instead of an empty page when data could not load, with a way to try again. */
export function ErrorState({ title = "Couldn’t load this page", message = "Check your connection and try again.", onRetry, style }: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="alert" style={[styles.container, style]}>
      <View style={[styles.mark, { backgroundColor: theme.surfaceMuted }]}><Text style={styles.emoji}>📡</Text></View>
      <Heading style={styles.centered}>{title}</Heading>
      <Body muted style={styles.centered}>{message}</Body>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 32 },
  mark: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emoji: { fontSize: 32, lineHeight: 40 },
  centered: { textAlign: "center" },
});
