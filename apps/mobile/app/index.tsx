import { Redirect } from "expo-router";
import { ErrorState } from "@/components/ErrorState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { useSession } from "@/session/SessionProvider";

export default function Index() {
  const { loading, user, profile, error, retry } = useSession();
  if (loading) return <LoadingScreen />;
  if (user && !profile && error) return <Screen><ErrorState onRetry={retry} /></Screen>;
  if (!user) return <Redirect href="/(auth)/sign-in" />;
  if (!profile?.onboardingComplete) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
