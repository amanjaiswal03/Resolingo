import { Text, View, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { LessonDeleteProvider } from "@/lessons/delete-lesson";
import { TAB_BAR_HEIGHT } from "@/playback/PlaybackProvider";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

const icon = (symbol: string, color: ColorValue) => <Text style={{ color, fontSize: 18 }}>{symbol}</Text>;

export default function TabsLayout() {
  const theme = useTheme();
  const { user } = useSession();
  if (!user) return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  return (
    <LessonDeleteProvider>
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: theme.primary, tabBarInactiveTintColor: theme.textMuted, tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border, height: TAB_BAR_HEIGHT, paddingTop: 2 }, tabBarLabelStyle: { fontSize: 11, fontWeight: "600" } }}>
      <Tabs.Screen name="index" options={{ title: "Today", tabBarIcon: ({ color }) => icon("✦", color) }} />
      <Tabs.Screen name="history" options={{ title: "Lessons", tabBarIcon: ({ color }) => icon("◫", color) }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color }) => icon("⚙", color) }} />
    </Tabs>
    </LessonDeleteProvider>
  );
}
