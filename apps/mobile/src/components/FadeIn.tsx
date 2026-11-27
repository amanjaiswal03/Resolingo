import { useEffect, useState, type PropsWithChildren } from "react";
import { Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

const DURATION_MS = 320;
const STAGGER_MS = 45;

/**
 * Rises and fades in when it first appears. Items in a list pass their index for a short stagger.
 *
 * This used a Reanimated `entering` animation, which can be dropped when the
 * view mounts while its tab is off screen, leaving the content invisible. Here
 * the fade is a plain animation, and a timer forces it fully visible
 * afterwards, so content can never stay hidden.
 */
export function FadeIn({ index = 0, style, children }: PropsWithChildren<{ index?: number; style?: StyleProp<ViewStyle> }>) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const delay = Math.min(index, 8) * STAGGER_MS;
    const animation = Animated.timing(progress, { toValue: 1, delay, duration: DURATION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    const settle = setTimeout(() => progress.setValue(1), delay + DURATION_MS + 150);
    return () => {
      clearTimeout(settle);
      animation.stop();
      progress.setValue(1);
    };
    // Only the first appearance animates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>{children}</Animated.View>;
}
