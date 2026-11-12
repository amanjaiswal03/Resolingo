import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/session/SessionProvider";
import { track } from "@/services/telemetry";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 20_000 } } });

function Navigation() {
  const router = useRouter();
  const segments = useSegments();
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
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="lesson/[id]" options={{ presentation: "card" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider><Navigation /></SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
