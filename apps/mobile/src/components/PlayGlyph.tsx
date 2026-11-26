import { View } from "react-native";

/**
 * Play triangle or pause bars drawn from views, so the icon is centered and
 * crisp at any size instead of depending on how a font draws ▶ and Ⅱ.
 */
export function PlayGlyph({ playing, color, size }: { playing: boolean; color: string; size: number }) {
  if (playing) {
    const bar = { width: size * 0.26, height: size * 0.8, borderRadius: size * 0.08, backgroundColor: color };
    return (
      <View accessibilityElementsHidden style={{ width: size, height: size, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: size * 0.2 }}>
        <View style={bar} />
        <View style={bar} />
      </View>
    );
  }
  const half = size * 0.44;
  return (
    <View accessibilityElementsHidden style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* The triangle's visual center sits left of its box, so it is nudged right. */}
      <View
        style={{
          marginLeft: size * 0.14,
          width: 0,
          height: 0,
          borderTopWidth: half,
          borderBottomWidth: half,
          borderLeftWidth: half * 1.7,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
          borderRadius: size * 0.04,
        }}
      />
    </View>
  );
}
