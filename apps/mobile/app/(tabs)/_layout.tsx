import { Pressable, View } from "react-native";
import { Tabs } from "expo-router";
import * as Haptics from "expo-haptics";
import { TabIcon } from "@/components/TabIcon";
import { LessonDeleteProvider } from "@/lessons/delete-lesson";
import { TAB_BAR_HEIGHT } from "@/playback/PlaybackProvider";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";


export default function TabsLayout() {
  const theme = useTheme();
  const { user } = useSession();
  if (!user) return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  return (
    <LessonDeleteProvider>
    <Tabs
      screenOptions={{
        headerShown: false,
        // Screens slide a little and cross-fade when switching tabs.
        animation: "shift",
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border, height: TAB_BAR_HEIGHT, paddingTop: 4 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginTop: 2 },
        // No ripple or opacity flash: the icon's own spring is the feedback.
        tabBarButton: ({ ref: _ref, ...props }) => <Pressable {...props} android_ripple={null} style={props.style} />,
      }}
      screenListeners={{ tabPress: () => { void Haptics.selectionAsync().catch(() => undefined); } }}
    >
      <Tabs.Screen name="index" options={{ title: "Today", tabBarIcon: ({ focused }) => <TabIcon name="today" focused={focused} color={focused ? theme.primary : theme.textMuted} /> }} />
      <Tabs.Screen name="history" options={{ title: "Lessons", tabBarIcon: ({ focused }) => <TabIcon name="lessons" focused={focused} color={focused ? theme.primary : theme.textMuted} /> }} />
      <Tabs.Screen name="skills" options={{ title: "Skills", tabBarIcon: ({ focused }) => <TabIcon name="skills" focused={focused} color={focused ? theme.primary : theme.textMuted} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ focused }) => <TabIcon name="settings" focused={focused} color={focused ? theme.primary : theme.textMuted} /> }} />
    </Tabs>
    </LessonDeleteProvider>
  );
}
