import { StyleSheet, Text, View } from "react-native";

/** Circular arrow with 10 in the middle, the same mark podcast apps use for a ten-second jump. */
export function SkipIcon({ direction, color }: { direction: "back" | "forward"; color: string }) {
  return (
    <View style={styles.wrap} accessibilityElementsHidden>
      <View style={direction === "forward" ? styles.forward : undefined}>
        <View style={[styles.arc, { borderColor: color, borderTopColor: "transparent" }]} />
        <View style={[styles.head, { borderBottomColor: color }]} />
      </View>
      <Text style={[styles.label, { color }]}>10</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  forward: { transform: [{ scaleX: -1 }] },
  arc: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2.5,
    borderTopColor: "transparent",
    transform: [{ rotate: "-48deg" }],
  },
  head: {
    position: "absolute",
    top: 1,
    left: 4,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    transform: [{ rotate: "-18deg" }],
  },
  label: { position: "absolute", fontSize: 12, lineHeight: 14, fontWeight: "800" },
});
