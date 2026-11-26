import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useTheme } from "@/theme/tokens";

export type TabIconName = "today" | "lessons" | "skills" | "settings";

const BOX = 24;
const STROKE = 2;

/**
 * Tab icons drawn from views, so they need no icon font or native module.
 * The selected tab gets a filled icon on a soft pill that springs in.
 */
export function TabIcon({ name, focused, color }: { name: TabIconName; focused: boolean; color: string }) {
  const theme = useTheme();
  const active = useSharedValue(focused ? 1 : 0);
  const bounce = useSharedValue(1);
  useEffect(() => {
    active.value = withSpring(focused ? 1 : 0, { damping: 18, stiffness: 220, mass: 0.6 });
    if (focused) bounce.value = withSequence(withTiming(0.86, { duration: 90 }), withSpring(1, { damping: 9, stiffness: 260, mass: 0.5 }));
  }, [active, bounce, focused]);
  const pill = useAnimatedStyle(() => ({ opacity: active.value, transform: [{ scaleX: 0.55 + active.value * 0.45 }] }));
  const icon = useAnimatedStyle(() => ({ transform: [{ scale: bounce.value }] }));
  return (
    <View style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.pill, { backgroundColor: theme.primaryTint }, pill]} />
      <Animated.View style={[styles.box, icon]}>
        {name === "today" ? <Sun color={color} filled={focused} />
          : name === "lessons" ? <Stack color={color} filled={focused} />
          : name === "skills" ? <Bars color={color} filled={focused} />
          : <Sliders color={color} filled={focused} hole={theme.surface} />}
      </Animated.View>
    </View>
  );
}

function Sun({ color, filled }: { color: string; filled: boolean }) {
  return (
    <View style={styles.center}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <View key={angle} style={[styles.ray, { backgroundColor: color, transform: [{ rotate: `${angle}deg` }, { translateY: -9.5 }] }]} />
      ))}
      <View style={[styles.sunCore, { borderColor: color, backgroundColor: filled ? color : "transparent" }]} />
    </View>
  );
}

function Stack({ color, filled }: { color: string; filled: boolean }) {
  return (
    <View style={styles.center}>
      <View style={[styles.stackBack, { borderColor: color }]} />
      <View style={[styles.stackFront, { borderColor: color, backgroundColor: filled ? color : "transparent" }]}>
        <View style={[styles.stackPlay, { borderLeftColor: filled ? "#FFFFFF" : color }]} />
      </View>
    </View>
  );
}

function Bars({ color, filled }: { color: string; filled: boolean }) {
  return (
    <View style={styles.bars}>
      {[9, 14, 19].map((height) => (
        <View key={height} style={[styles.bar, { height, borderColor: color, backgroundColor: filled ? color : "transparent" }]} />
      ))}
    </View>
  );
}

function Sliders({ color, filled, hole }: { color: string; filled: boolean; hole: string }) {
  return (
    <View style={styles.sliders}>
      {[6, 14].map((knob, index) => (
        <View key={index} style={styles.sliderRow}>
          <View style={[styles.sliderLine, { backgroundColor: color }]} />
          <View style={[styles.knob, { left: knob, borderColor: color, backgroundColor: filled ? color : hole }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 54, height: 28, alignItems: "center", justifyContent: "center" },
  pill: { ...StyleSheet.absoluteFill, borderRadius: 14 },
  box: { width: BOX, height: BOX, alignItems: "center", justifyContent: "center" },
  center: { width: BOX, height: BOX, alignItems: "center", justifyContent: "center" },
  ray: { position: "absolute", width: STROKE, height: 4, borderRadius: 1 },
  sunCore: { width: 11, height: 11, borderRadius: 6, borderWidth: STROKE },
  stackBack: { position: "absolute", top: 3, width: 16, height: 5, borderTopLeftRadius: 3, borderTopRightRadius: 3, borderWidth: STROKE, borderBottomWidth: 0 },
  stackFront: { marginTop: 5, width: 20, height: 14, borderRadius: 4, borderWidth: STROKE, alignItems: "center", justifyContent: "center" },
  stackPlay: { marginLeft: 2, width: 0, height: 0, borderTopWidth: 3.5, borderBottomWidth: 3.5, borderLeftWidth: 5.5, borderTopColor: "transparent", borderBottomColor: "transparent" },
  bars: { width: BOX, height: BOX, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 3, paddingBottom: 2 },
  bar: { width: 5.5, borderRadius: 2, borderWidth: STROKE },
  sliders: { width: BOX, height: BOX, justifyContent: "center", gap: 7, paddingHorizontal: 1 },
  sliderRow: { height: 6, justifyContent: "center" },
  sliderLine: { height: STROKE, borderRadius: 1 },
  knob: { position: "absolute", top: 0, width: 7, height: 7, borderRadius: 4, borderWidth: STROKE },
});
