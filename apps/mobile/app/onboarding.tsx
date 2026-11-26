import { useState, type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { languages, type CefrLevel, type LanguageId } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { SelectModal } from "@/components/SelectModal";
import { SettingsGroup, SettingsSwitchRow } from "@/components/SettingsList";
import { Body, Title } from "@/components/Typography";
import { languageFlag } from "@/languages/flags";
import { api } from "@/services/api";
import { registerForPush } from "@/services/notifications";
import { track } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

const languageOptions = languages.map((language) => ({ value: language.id, label: language.label, icon: languageFlag(language.id) }));
const levels: { value: CefrLevel; name: string; description: string }[] = [
  { value: "A1", name: "Starting out", description: "You know a few words and simple phrases." },
  { value: "A2", name: "Elementary", description: "You can handle everyday basics like shopping and directions." },
  { value: "B1", name: "Intermediate", description: "You get by on trips and can talk about familiar topics." },
  { value: "B2", name: "Upper intermediate", description: "You follow most conversations and speak with some ease." },
  { value: "C1", name: "Advanced", description: "You speak fluently and want to polish the finer points." },
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

  const swapLanguages = () => {
    setNativeLanguage(targetLanguage);
    setTargetLanguage(nativeLanguage);
  };
  const selectedLevel = levels.find((option) => option.value === level) ?? levels[0]!;
  const inputStyle = [styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }];

  return (
    <Screen style={styles.content}>
      {edit ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={leave} hitSlop={10} style={styles.back}>
          <Text style={[styles.backLabel, { color: theme.primary }]}>‹ Back</Text>
        </Pressable>
      ) : null}
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: theme.primary }]}>{edit ? "LEARNING PREFERENCES" : "WELCOME TO RESOLINGO"}</Text>
        <Title>{edit ? "Tune your lessons" : "Let’s set up your lessons"}</Title>
        <Body muted>Every conversation and grammar lesson is written for these choices. You can change them any time.</Body>
      </View>

      <Section step={1} title="What should we call you?">
        <TextInput testID="nickname-input" value={nickname} onChangeText={setNickname} maxLength={40} placeholder="Your name" placeholderTextColor={theme.textMuted} autoComplete="given-name" textContentType="givenName" accessibilityLabel="Your name" style={inputStyle} />
      </Section>

      <Section step={2} title="Your languages">
        <View style={styles.languages}>
          <SelectModal label="I speak" value={nativeLanguage} options={languageOptions} onChange={(value) => setNativeLanguage(value as LanguageId)} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Swap languages"
            onPress={swapLanguages}
            hitSlop={6}
            style={[styles.swap, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Text style={[styles.swapIcon, { color: theme.primary }]}>⇅</Text>
          </Pressable>
          <SelectModal label="I want to learn" value={targetLanguage} options={languageOptions} onChange={(value) => setTargetLanguage(value as LanguageId)} />
        </View>
        {nativeLanguage === targetLanguage ? <Body style={[styles.warning, { color: theme.danger }]}>Pick two different languages.</Body> : null}
      </Section>

      <Section step={3} title="Your level">
        <View accessibilityRole="radiogroup" style={styles.levels}>
          {levels.map((option) => {
            const selected = option.value === level;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={`${option.value}, ${option.name}`}
                accessibilityState={{ selected }}
                onPress={() => setLevel(option.value)}
                style={[styles.level, { backgroundColor: selected ? theme.primaryFill : theme.surface, borderColor: selected ? theme.primaryFill : theme.border }]}
              >
                <Text style={[styles.levelCode, { color: selected ? theme.onPrimary : theme.text }]}>{option.value}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.levelInfo, { backgroundColor: theme.primaryTint }]}>
          <Text style={[styles.levelName, { color: theme.text }]}>{selectedLevel.name}</Text>
          <Body muted style={styles.levelDescription}>{selectedLevel.description}</Body>
        </View>
      </Section>

      <Section step={4} title="Reminders and privacy">
        <SettingsGroup>
          <SettingsSwitchRow icon="⏰" iconTint={`${theme.amber}55`} label="Daily reminder" detail="Only if you haven’t learned that day." value={reminderEnabled} onValueChange={setReminderEnabled} />
          {reminderEnabled ? (
            <View style={styles.timeRow}>
              <Body muted style={styles.timeLabel}>Remind me at</Body>
              <TextInput value={reminderTime} onChangeText={setReminderTime} keyboardType="numbers-and-punctuation" maxLength={5} placeholder="18:00" placeholderTextColor={theme.textMuted} accessibilityLabel={`Reminder time, 24-hour, ${timezone}`} style={[styles.timeInput, { backgroundColor: theme.surfaceMuted, color: theme.text }]} />
            </View>
          ) : null}
          <SettingsSwitchRow icon="📊" iconTint={`${theme.sky}55`} label="Help improve Resolingo" detail="Share minimal usage and crash events. Lesson text is never included." value={telemetryConsent} onValueChange={setTelemetryConsent} />
        </SettingsGroup>
      </Section>

      <Button label={edit ? "Save changes" : "Start learning"} loading={saving} onPress={() => void save()} />
    </Screen>
  );
}

function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.step, { backgroundColor: theme.primaryTint }]}>
          <Text style={[styles.stepText, { color: theme.primary }]}>{step}</Text>
        </View>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 26 },
  back: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center" },
  backLabel: { fontSize: 16, fontWeight: "700" },
  header: { gap: 8 },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: "800", letterSpacing: 1 },
  section: { gap: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  step: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 13, fontWeight: "800" },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: "700" },
  input: { minHeight: 54, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 16 },
  languages: { gap: 4 },
  swap: { alignSelf: "center", width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", marginBottom: -10, marginTop: 2, zIndex: 1 },
  swapIcon: { fontSize: 18, lineHeight: 22, fontWeight: "800" },
  warning: { fontSize: 14, lineHeight: 20 },
  levels: { flexDirection: "row", gap: 8 },
  level: { flex: 1, minHeight: 52, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  levelCode: { fontSize: 17, fontWeight: "800" },
  levelInfo: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, gap: 2 },
  levelName: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  levelDescription: { fontSize: 14, lineHeight: 20 },
  timeRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 60, paddingRight: 14, paddingVertical: 8 },
  timeLabel: { flex: 1, fontSize: 15 },
  timeInput: { width: 96, minHeight: 40, borderRadius: 10, paddingHorizontal: 12, fontSize: 17, fontWeight: "700", textAlign: "center", fontVariant: ["tabular-nums"] },
});
