import type { ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Quick to sink, a little bouncy on release, so taps feel physical without lag. */
const PRESS_IN = { duration: 90 };
const RELEASE = { damping: 14, stiffness: 320, mass: 0.6 };

export type PressFeedback = "none" | "light" | "selection";

/**
 * A Pressable that sinks slightly while held and springs back on release,
 * with optional haptic feedback. Use it for cards, tiles and buttons.
 */
export function PressableScale({
  children,
  style,
  scaleTo = 0.97,
  haptic = "light",
  onPressIn,
  onPressOut,
  onPress,
  disabled,
  ...props
}: Omit<PressableProps, "style" | "children"> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: PressFeedback;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={(event) => {
        scale.set(withTiming(scaleTo, PRESS_IN));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withSpring(1, RELEASE));
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (haptic === "light") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        else if (haptic === "selection") void Haptics.selectionAsync().catch(() => undefined);
        onPress?.(event);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
