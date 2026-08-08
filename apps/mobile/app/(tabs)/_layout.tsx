import { Text, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { useTheme } from "@/theme/tokens";

const icon = (symbol: string, color: ColorValue) => <Text style={{ color, fontSize: 20 }}>{symbol}</Text>;

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: theme.primary, tabBarInactiveTintColor: theme.textMuted, tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border, height: 66, paddingTop: 6 }, tabBarLabelStyle: { fontSize: 12, fontWeight: "600" } }}>
      <Tabs.Screen name="index" options={{ title: "Today", tabBarIcon: ({ color }) => icon("✦", color) }} />
      <Tabs.Screen name="history" options={{ title: "Lessons", tabBarIcon: ({ color }) => icon("◫", color) }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color }) => icon("⚙", color) }} />
    </Tabs>
  );
}
