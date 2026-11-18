import type { PropsWithChildren } from "react";
import { ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/theme/tokens";

export function Screen({ children, scroll = true, style, backgroundColor, onScrollBeginDrag }: PropsWithChildren<{ scroll?: boolean; style?: ViewStyle; backgroundColor?: string; onScrollBeginDrag?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void }>) {
  const theme = useTheme();
  const content = <View style={[styles.content, style]}>{children}</View>;
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: backgroundColor ?? theme.background }]} edges={["top", "left", "right"]}>
      {scroll ? <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" onScrollBeginDrag={onScrollBeginDrag}>{content}</ScrollView> : content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1 },
  content: { flex: 1, paddingHorizontal: 20, paddingVertical: 16, gap: 16 },
});
