import { Alert, Linking, StyleSheet, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { api } from "@/services/api";
import { logOut } from "@/services/auth";
import { setTelemetryEnabled, track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

export default function SettingsScreen() {
  const { profile } = useSession();
  const router = useRouter();
  const theme = useTheme();
  if (!profile) return <LoadingScreen />;
  const toggleTelemetry = async (enabled: boolean) => {
    await api.setTelemetryConsent(enabled);
    await setTelemetryEnabled(enabled);
  };
  const toggleReminder = async (enabled: boolean) => {
    await api.updateReminder({ enabled, time: profile.reminderTime, timezone: profile.timezone });
  };
  const confirmDelete = () => Alert.alert("Delete your account?", "This permanently removes your profile, lessons, audio, and reminder tokens.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete permanently", style: "destructive", onPress: () => void (async () => {
      try {
        await track("account_deletion");
        await api.deleteAccount();
        await logOut();
      } catch (error) {
        Alert.alert("Couldn’t delete account", String(error));
      }
    })() },
  ]);
  return (
    <Screen>
      <View style={styles.header}><Title>Settings</Title><Body muted>Control your learning preferences and privacy.</Body></View>
      <Card><Heading>{profile.nickname}</Heading><Body muted>{profile.nativeLanguage} → {profile.targetLanguage} · {profile.level}</Body><Button label="Edit learning preferences" variant="secondary" onPress={() => router.push("/onboarding?edit=1")} /></Card>
      <Card style={styles.row}><View style={styles.copy}><Heading>Daily reminder</Heading><Body muted>{profile.reminderTime} · {profile.timezone}</Body></View><Switch value={profile.reminderEnabled} onValueChange={(value) => void toggleReminder(value)} trackColor={{ true: theme.primary }} /></Card>
      <Card style={styles.row}><View style={styles.copy}><Heading>Minimal analytics</Heading><Body muted>Anonymous funnel and crash events only. Lesson text is excluded.</Body></View><Switch value={profile.telemetryConsent} onValueChange={(value) => void toggleTelemetry(value)} trackColor={{ true: theme.primary }} /></Card>
      <Card><Button label="Privacy policy" variant="ghost" onPress={() => void Linking.openURL("https://resolingo.app/privacy")} /><Button label="Contact support" variant="ghost" onPress={() => void Linking.openURL("mailto:support@resolingo.app")} /></Card>
      <View style={styles.actions}><Button label="Sign out" variant="secondary" onPress={() => void logOut()} /><Button label="Delete account" variant="danger" onPress={confirmDelete} /></View>
    </Screen>
  );
}

const styles = StyleSheet.create({ header: { gap: 7, marginBottom: 6 }, row: { flexDirection: "row", alignItems: "center" }, copy: { flex: 1, gap: 3 }, actions: { gap: 10, marginTop: 8, paddingBottom: 20 } });
