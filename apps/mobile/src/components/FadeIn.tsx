import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

/** Rises and fades in when it first appears. Items in a list pass their index for a short stagger. */
export function FadeIn({ index = 0, style, children }: PropsWithChildren<{ index?: number; style?: StyleProp<ViewStyle> }>) {
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(320)} style={style}>
      {children}
    </Animated.View>
  );
}
