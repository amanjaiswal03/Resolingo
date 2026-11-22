import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

/**
 * A ring drawn with two clipped half circles, so it needs no SVG library.
 * Each half rotates in from 12 o'clock and 6 o'clock to show the progress.
 */
export function ProgressRing({ size, stroke, progress, color, track, children }: {
  size: number;
  stroke: number;
  progress: number;
  color: string;
  track: string;
  children?: ReactNode;
}) {
  const half = size / 2;
  const degrees = Math.max(0, Math.min(1, progress)) * 360;
  const right = Math.min(degrees, 180);
  const left = Math.max(degrees - 180, 0);
  const circle = { width: size, height: size, borderRadius: half, borderWidth: stroke };
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      <View style={[StyleSheet.absoluteFill, circle, { borderColor: track }]} />
      {right > 0 ? (
        <View style={[styles.clip, { left: half, width: half, height: size }]}>
          <View style={{ position: "absolute", left: -half, width: size, height: size, transform: [{ rotate: `${right}deg` }] }}>
            <View style={[styles.clip, { left: 0, width: half, height: size }]}>
              <View style={[circle, { borderColor: color }]} />
            </View>
          </View>
        </View>
      ) : null}
      {left > 0 ? (
        <View style={[styles.clip, { left: 0, width: half, height: size }]}>
          <View style={{ position: "absolute", left: 0, width: size, height: size, transform: [{ rotate: `${left}deg` }] }}>
            <View style={[styles.clip, { left: half, width: half, height: size }]}>
              <View style={[circle, { position: "absolute", left: -half, borderColor: color }]} />
            </View>
          </View>
        </View>
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { position: "absolute", top: 0, overflow: "hidden" },
  center: { alignItems: "center", justifyContent: "center" },
});
