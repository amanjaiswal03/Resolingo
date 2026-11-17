import { useEffect } from "react";
import { useColorScheme, View } from "react-native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/session/SessionProvider";
import { track } from "@/services/telemetry";
import { useTheme } from "@/theme/tokens";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 20_000 } } });

function Navigation() {
  const router = useRouter();
  const segments = useSegments();
  const theme = useTheme();
  const { loading, user, profile } = useSession();
  useEffect(() => {
    if (loading) return;
    const route = segments.join("/");
    if (!user) {
      if (!route.includes("sign-in")) router.replace("/(auth)/sign-in");
      return;
    }
    if (!profile?.onboardingComplete) {
      if (!route.includes("onboarding")) router.replace("/onboarding");
      return;
    }
    if (route.length === 0 || route.includes("sign-in")) router.replace("/(tabs)");
  }, [loading, user, profile?.onboardingComplete, segments, router]);
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const path = response.notification.request.content.data?.path;
      const event = response.notification.request.content.data?.event;
      if (event === "reminder" && profile?.telemetryConsent) void track("reminder_opened");
      if (typeof path === "string") router.push(path as never);
    });
    return () => subscription.remove();
  }, [profile?.telemetryConsent, router]);
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
        <Stack.Screen name="index" options={{ animation: "none" }} />
        <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
        <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
        <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
        <Stack.Screen name="lesson/[id]" options={{ presentation: "card", gestureEnabled: false, fullScreenGestureEnabled: false }} />
        <Stack.Screen name="say/index" options={{ presentation: "card" }} />
        <Stack.Screen name="say/[id]" options={{ presentation: "card" }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const base = colorScheme === "dark" ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: { ...base.colors, background: theme.background, card: theme.surface, text: theme.text, border: theme.border, primary: theme.primary, notification: theme.danger },
  };
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ThemeProvider value={navigationTheme}>
            <Navigation />
          </ThemeProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
