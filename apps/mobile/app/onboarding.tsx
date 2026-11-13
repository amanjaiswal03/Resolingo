import { useState } from "react";
import { Alert, StyleSheet, Switch, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { languages, type CefrLevel, type LanguageId } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { SelectModal } from "@/components/SelectModal";
import { Body, Heading, Title } from "@/components/Typography";
import { api } from "@/services/api";
import { registerForPush } from "@/services/notifications";
import { track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

const languageOptions = languages.map((language) => ({ value: language.id, label: language.label }));
const levelOptions = [
  { value: "A1", label: "A1 · Starting out" }, { value: "A2", label: "A2 · Elementary" },
  { value: "B1", label: "B1 · Intermediate" }, { value: "B2", label: "B2 · Upper intermediate" },
  { value: "C1", label: "C1 · Advanced" },
];

export default function OnboardingScreen() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { user, profile } = useSession();
  const router = useRouter();
  const theme = useTheme();
  const [nickname, setNickname] = useState(profile?.nickname ?? user?.displayName?.split(" ")[0] ?? "");
  const [nativeLanguage, setNativeLanguage] = useState<LanguageId>(profile?.nativeLanguage ?? "en-US");
  const [targetLanguage, setTargetLanguage] = useState<LanguageId>(profile?.targetLanguage ?? "de-DE");
  const [level, setLevel] = useState<CefrLevel>(profile?.level ?? "A1");
  const [reminderEnabled, setReminderEnabled] = useState(profile?.reminderEnabled ?? true);
  const [reminderTime, setReminderTime] = useState(profile?.reminderTime ?? "18:00");
  const [telemetryConsent, setTelemetryConsent] = useState(profile?.telemetryConsent ?? false);
  const [saving, setSaving] = useState(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/settings");
  };

  const save = async () => {
    if (!nickname.trim()) return Alert.alert("Add your name", "Tell us what we should call you.");
    if (nativeLanguage === targetLanguage) return Alert.alert("Choose two languages", "Your teaching and learning languages must be different.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) return Alert.alert("Check reminder time", "Use 24-hour HH:MM format.");
    setSaving(true);
    try {
      await api.initializeProfile({ nickname: nickname.trim(), nativeLanguage, targetLanguage, level, timezone, reminderEnabled, reminderTime, telemetryConsent });
      if (reminderEnabled) await registerForPush();
      if (telemetryConsent) await track("onboarding_completed");
      router.replace("/(tabs)");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      const code = __DEV__ && error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
      Alert.alert("Couldn’t save", code ? `${code}: ${message}` : message);
    } finally { setSaving(false); }
  };

  return (
    <Screen>
      {edit ? <Button label="‹ Back" variant="ghost" onPress={leave} /> : null}
      <View style={styles.header}>
        <Body muted>{edit ? "LEARNING SETTINGS" : "WELCOME TO RESOLINGO"}</Body>
        <Title>{edit ? "Tune your lessons" : "Make it yours"}</Title>
        <Body muted>We use these preferences to create every grammar and conversation lesson.</Body>
      </View>
      <View style={styles.form}>
        <View style={styles.field}><Body muted>What should we call you?</Body><TextInput testID="nickname-input" value={nickname} onChangeText={setNickname} maxLength={40} placeholder="Your name" placeholderTextColor={theme.textMuted} style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]} /></View>
        <SelectModal label="I understand" value={nativeLanguage} options={languageOptions} onChange={(value) => setNativeLanguage(value as LanguageId)} />
        <SelectModal label="I want to learn" value={targetLanguage} options={languageOptions} onChange={(value) => setTargetLanguage(value as LanguageId)} />
        <SelectModal label="My current level" value={level} options={levelOptions} onChange={(value) => setLevel(value as CefrLevel)} />
        <View style={[styles.preference, { backgroundColor: theme.surface, borderColor: theme.border }]}><View style={styles.preferenceText}><Heading>Daily reminder</Heading><Body muted>We’ll only remind you if you haven’t learned that day.</Body></View><Switch value={reminderEnabled} onValueChange={setReminderEnabled} trackColor={{ true: theme.primary }} /></View>
        {reminderEnabled ? <View style={styles.field}><Body muted>Reminder time · {timezone}</Body><TextInput value={reminderTime} onChangeText={setReminderTime} keyboardType="numbers-and-punctuation" maxLength={5} placeholder="18:00" placeholderTextColor={theme.textMuted} style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]} /></View> : null}
        <View style={[styles.preference, { backgroundColor: theme.surface, borderColor: theme.border }]}><View style={styles.preferenceText}><Heading>Help improve Resolingo</Heading><Body muted>Share a minimal set of usage and crash events. Lesson text is never included.</Body></View><Switch value={telemetryConsent} onValueChange={setTelemetryConsent} trackColor={{ true: theme.primary }} /></View>
      </View>
      <Button label={edit ? "Save changes" : "Start learning"} loading={saving} onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 8, marginBottom: 4 }, form: { gap: 16 }, field: { gap: 7 },
  input: { minHeight: 52, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 16 },
  preference: { minHeight: 86, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  preferenceText: { flex: 1, gap: 3 },
});
