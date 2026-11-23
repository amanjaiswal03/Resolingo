import { ActivityIndicator, StyleSheet, type StyleProp, type TextStyle } from "react-native";
import { Body } from "@/components/Typography";
import type { ExampleAudioState } from "./use-example-audio";

/** Play, pause or a spinner while the clip loads, for the round audio buttons in Skills. */
export function AudioGlyph({ state, color, style }: { state: ExampleAudioState; color: string; style?: StyleProp<TextStyle> }) {
  if (state === "loading") return <ActivityIndicator color={color} />;
  return <Body style={[styles.glyph, style, { color }]}>{state === "playing" ? "❚❚" : "▶"}</Body>;
}

const styles = StyleSheet.create({
  glyph: { fontWeight: "800" },
});
