import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { languageById, type Phrase } from "@resolingo/shared";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { Body, Heading, Title } from "@/components/Typography";
import { api } from "@/services/api";
import { subscribePhrases } from "@/services/phrases";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message.replace(/^\[.*?\]\s*/, "");
  }
  return "Please try again.";
}

export default function SayScreen() {
  const { user, profile } = useSession();
  const router = useRouter();
  const theme = useTheme();
  const [text, setText] = useState("");
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!user) return;
    return subscribePhrases(user.uid, setPhrases);
  }, [user]);
  const submit = async () => {
    const query = text.trim();
    if (!query || submitting) return;
    setSubmitting(true);
    try {
      const result = await api.translatePhrase(query);
      router.push(`/say/${result.phraseId}`);
    } catch (error) {
      Alert.alert("Couldn’t translate that", messageOf(error));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}><Body muted>Back</Body></Pressable>
      <View style={styles.header}>
        <Title>How would you say?</Title>
        <Body muted>Type a sentence in your language. You’ll hear it in {profile ? languageById[profile.targetLanguage].label : "your target language"}, then you can make a short lesson.</Body>
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        maxLength={280}
        placeholder="I need to buy a pair of shoes."
        placeholderTextColor={theme.textMuted}
        style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
      />
      <Button label={submitting ? "Translating…" : "Translate"} loading={submitting} disabled={text.trim().length === 0} onPress={() => void submit()} />
      <Heading>Past phrases</Heading>
      {phrases.length === 0 ? <Body muted>Your phrases will show up here.</Body> : phrases.map((phrase) => (
        <Pressable key={phrase.id} accessibilityRole="button" accessibilityLabel={phrase.nativeText} onPress={() => router.push(`/say/${phrase.id}`)}>
          <Card>
            <Body>{phrase.nativeText}</Body>
            <Body muted>{phrase.translation}</Body>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 8 },
  input: { minHeight: 120, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, textAlignVertical: "top" },
});
