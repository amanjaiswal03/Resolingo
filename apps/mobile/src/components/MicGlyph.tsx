import { View } from "react-native";

/** A microphone drawn from views, sized to a square box. */
export function MicGlyph({ color, size }: { color: string; size: number }) {
  const width = size * 0.42;
  return (
    <View accessibilityElementsHidden style={{ width: size, height: size, alignItems: "center" }}>
      <View style={{ width, height: size * 0.6, borderRadius: width / 2, backgroundColor: color }} />
      <View style={{ width: size * 0.7, height: size * 0.3, marginTop: -size * 0.22, borderBottomLeftRadius: size, borderBottomRightRadius: size, borderWidth: 2, borderTopWidth: 0, borderColor: color }} />
      <View style={{ width: 2, height: size * 0.14, backgroundColor: color }} />
    </View>
  );
}
