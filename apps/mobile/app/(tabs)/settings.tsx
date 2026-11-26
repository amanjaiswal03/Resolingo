import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PressableScale } from "@/components/PressableScale";
import { Screen } from "@/components/Screen";
import { SettingsGroup, SettingsRow, SettingsSwitchRow } from "@/components/SettingsList";
import { Body, Heading, Title } from "@/components/Typography";
import { languageFlag, languageLabel } from "@/languages/flags";
import { api } from "@/services/api";
import { logOut } from "@/services/auth";
import { setTelemetryEnabled, track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

const levelName = { A1: "Starting out", A2: "Elementary", B1: "Intermediate", B2: "Upper intermediate", C1: "Advanced" } as const;

export default function SettingsScreen() {
  const { user, profile } = useSession();
  const router = useRouter();
  const theme = useTheme();
  if (!user) return null;
  if (!profile) return <LoadingScreen />;
  const toggleTelemetry = async (enabled: boolean) => {
    await api.setTelemetryConsent(enabled);
    await setTelemetryEnabled(enabled);
  };
  const toggleReminder = async (enabled: boolean) => {
    await api.updateReminder({ enabled, time: profile.reminderTime, timezone: profile.timezone });
  };
  const editPreferences = () => router.push("/onboarding?edit=1");
  const confirmSignOut = () => Alert.alert("Sign out?", "Your lessons stay saved to your account.", [
    { text: "Cancel", style: "cancel" },
    { text: "Sign out", onPress: () => void logOut() },
  ]);
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
  const initial = profile.nickname.trim().charAt(0).toLocaleUpperCase() || "?";
  const version = Constants.expoConfig?.version;
  return (
    <Screen style={styles.content}>
      <Title>Settings</Title>

      <PressableScale scaleTo={0.98}
        accessibilityRole="button"
        accessibilityLabel={`${profile.nickname}. Learning ${languageLabel(profile.targetLanguage)} from ${languageLabel(profile.nativeLanguage)}, level ${profile.level}. Edit learning preferences`}
        onPress={editPreferences}
        style={[styles.profile, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <View style={styles.profileTop}>
          <View style={[styles.avatar, { backgroundColor: theme.primaryFill }]}>
            <Text style={[styles.avatarText, { color: theme.onPrimary }]}>{initial}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Heading numberOfLines={1}>{profile.nickname}</Heading>
            <Body muted style={styles.small}>Level {profile.level} · {levelName[profile.level]}</Body>
          </View>
          <Text style={[styles.edit, { color: theme.primary }]}>Edit</Text>
        </View>
        <View style={[styles.pair, { backgroundColor: theme.surfaceMuted }]}>
          <View style={styles.pairSide}>
            <Text style={styles.flag}>{languageFlag(profile.nativeLanguage)}</Text>
            <View style={styles.pairCopy}>
              <Body muted style={styles.pairCaption}>I speak</Body>
              <Body numberOfLines={2} style={styles.pairLabel}>{languageLabel(profile.nativeLanguage)}</Body>
            </View>
          </View>
          <Text style={[styles.arrow, { color: theme.textMuted }]}>→</Text>
          <View style={styles.pairSide}>
            <Text style={styles.flag}>{languageFlag(profile.targetLanguage)}</Text>
            <View style={styles.pairCopy}>
              <Body muted style={styles.pairCaption}>Learning</Body>
              <Body numberOfLines={2} style={styles.pairLabel}>{languageLabel(profile.targetLanguage)}</Body>
            </View>
          </View>
        </View>
      </PressableScale>

      <SettingsGroup title="Learning">
        <SettingsRow icon="✏️" label="Learning preferences" detail="Languages, level and name" onPress={editPreferences} />
        <SettingsSwitchRow
          icon="⏰"
          iconTint={`${theme.amber}55`}
          label="Daily reminder"
          detail={profile.reminderEnabled ? `Every day at ${profile.reminderTime}` : "Off"}
          value={profile.reminderEnabled}
          onValueChange={(value) => void toggleReminder(value)}
        />
      </SettingsGroup>

      <SettingsGroup title="Privacy" footer="Anonymous usage and crash events only. Lesson text is never included.">
        <SettingsSwitchRow
          icon="📊"
          iconTint={`${theme.sky}55`}
          label="Share minimal analytics"
          value={profile.telemetryConsent}
          onValueChange={(value) => void toggleTelemetry(value)}
        />
        <SettingsRow icon="🔒" iconTint={`${theme.sky}55`} label="Privacy policy" onPress={() => void Linking.openURL("https://resolingo.app/privacy")} />
      </SettingsGroup>

      <SettingsGroup title="Help">
        <SettingsRow icon="💬" iconTint={`${theme.coral}33`} label="Contact support" onPress={() => void Linking.openURL("mailto:support@resolingo.app")} />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow icon="🚪" iconTint={theme.surfaceMuted} label="Sign out" onPress={confirmSignOut} />
      </SettingsGroup>

      <View style={styles.footer}>
        {/* Deleting is rare and permanent, so it is a quiet link and the alert carries the warning. */}
        <Pressable accessibilityRole="button" accessibilityLabel="Delete account" onPress={confirmDelete} hitSlop={10} style={styles.deleteLink}>
          <Text style={[styles.deleteText, { color: theme.danger }]}>Delete account</Text>
        </Pressable>
        {version ? <Text style={[styles.version, { color: theme.textMuted }]}>Resolingo {version}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 22 },
  profile: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 14 },
  profileTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 22, lineHeight: 28, fontWeight: "800" },
  profileCopy: { flex: 1 },
  small: { fontSize: 14, lineHeight: 20 },
  edit: { fontSize: 15, fontWeight: "700" },
  pair: { flexDirection: "row", alignItems: "center", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  pairSide: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  pairCopy: { flex: 1 },
  pairCaption: { fontSize: 12, lineHeight: 16 },
  pairLabel: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  flag: { fontSize: 26, lineHeight: 32 },
  arrow: { fontSize: 18, fontWeight: "700" },
  footer: { alignItems: "center", gap: 6, paddingTop: 4, paddingBottom: 24 },
  deleteLink: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  deleteText: { fontSize: 14, fontWeight: "600" },
  version: { fontSize: 12 },
});
