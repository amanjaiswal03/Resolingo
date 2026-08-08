import { Redirect } from "expo-router";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useSession } from "@/session/SessionProvider";

export default function Index() {
  const { loading, user, profile } = useSession();
  if (loading) return <LoadingScreen />;
  if (!user) return <Redirect href="/(auth)/sign-in" />;
  if (!profile?.onboardingComplete) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
