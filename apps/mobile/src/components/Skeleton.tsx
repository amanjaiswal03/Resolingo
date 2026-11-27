import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { Screen } from "./Screen";
import { useTheme } from "@/theme/tokens";

const Pulse = createContext<Animated.Value | null>(null);

/** One shared, gentle pulse for every block on a skeleton page. Holds still when Reduce Motion is on. */
export function SkeletonPulse({ children }: PropsWithChildren) {
  const [value] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]));
      loop.start();
    });
    return () => { cancelled = true; loop?.stop(); };
  }, [value]);
  return <Pulse.Provider value={value}>{children}</Pulse.Provider>;
}

/** A grey stand-in for a piece of content that is still loading. */
export function SkeletonBlock({ width = "100%", height = 14, radius = 8, style }: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const opacity = useContext(Pulse) ?? 1;
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: theme.surfaceMuted, opacity }, style]} />;
}

/** A lesson row placeholder that matches LessonRow's shape. */
export function SkeletonLessonRow() {
  const theme = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <SkeletonBlock width={56} height={56} radius={14} />
      <View style={styles.rowCopy}>
        <SkeletonBlock width="75%" height={16} />
        <SkeletonBlock width="40%" height={12} />
      </View>
    </View>
  );
}

/** A full page skeleton, wrapped in the same Screen as real content so nothing jumps when it arrives. */
export function SkeletonScreen({ children, label = "Loading" }: PropsWithChildren<{ label?: string }>) {
  return (
    <Screen>
      <SkeletonPulse>
        <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} style={styles.page}>
          {children}
        </View>
      </SkeletonPulse>
    </Screen>
  );
}

/** Today: greeting, title, quota, lesson of the day, two choice tiles and recent lessons. */
export function TodaySkeleton() {
  return (
    <SkeletonScreen label="Loading today">
      <View style={styles.header}>
        <SkeletonBlock width="45%" height={16} />
        <SkeletonBlock width="85%" height={32} radius={10} />
        <SkeletonBlock width="55%" height={14} />
      </View>
      <SkeletonBlock height={220} radius={26} />
      <SkeletonBlock width="35%" height={12} />
      <View style={styles.tiles}>
        <SkeletonBlock height={176} radius={24} style={styles.tile} />
        <SkeletonBlock height={176} radius={24} style={styles.tile} />
      </View>
      <SkeletonLessonRow />
      <SkeletonLessonRow />
    </SkeletonScreen>
  );
}

/** Lessons: title, summary, then a date heading with rows. */
export function LessonsSkeleton() {
  return (
    <SkeletonScreen label="Loading your lessons">
      <View style={styles.header}>
        <SkeletonBlock width="60%" height={32} radius={10} />
        <SkeletonBlock width="70%" height={14} />
      </View>
      {[3, 2].map((rows, group) => (
        <View key={group} style={styles.group}>
          <SkeletonBlock width="25%" height={12} />
          {Array.from({ length: rows }, (_, index) => <SkeletonLessonRow key={index} />)}
        </View>
      ))}
    </SkeletonScreen>
  );
}

/** Skills: title, the weekly card, the view picker and a grid of skill tiles. */
export function SkillsSkeleton() {
  return (
    <SkeletonScreen label="Loading your skills">
      <View style={styles.header}>
        <SkeletonBlock width="40%" height={32} radius={10} />
        <SkeletonBlock width="30%" height={14} />
      </View>
      <SkeletonBlock height={230} radius={24} />
      <SkeletonBlock height={42} radius={999} />
      <View style={styles.grid}>
        {Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} height={168} radius={20} style={styles.gridTile} />)}
      </View>
    </SkeletonScreen>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  header: { gap: 10 },
  tiles: { flexDirection: "row", gap: 12 },
  tile: { flex: 1 },
  group: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 10 },
  rowCopy: { flex: 1, gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  gridTile: { flexGrow: 1, flexBasis: "45%" },
});
