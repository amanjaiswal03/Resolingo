import { useState } from "react";
import { Image, Platform, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Button } from "@/components/Button";
import { Body, Title } from "@/components/Typography";
import { Screen } from "@/components/Screen";
import { signInWithApple, signInWithGoogle } from "@/services/auth";
import { report } from "@/services/telemetry";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/tokens";

export default function SignInScreen() {
  const theme = useTheme();
  const { user } = useSession();
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState("");
  const signedIn = Boolean(user);
  const run = async (provider: "google" | "apple") => {
    setLoading(provider); setError("");
    try { await (provider === "google" ? signInWithGoogle() : signInWithApple()); }
    catch (nextError) { report(nextError); setError(nextError instanceof Error ? nextError.message : "Sign-in failed."); setLoading(null); }
  };
  return (
    <LinearGradient colors={[theme.navy, "#132B56"]} style={styles.gradient}>
      <Screen style={styles.screen} backgroundColor="transparent">
        <View style={styles.hero}>
          <Image source={require("../../assets/resolingo-icon.png")} style={styles.logo} accessibilityLabel="Resolingo logo" />
          <Title style={styles.white}>Learn the language you’ll actually use.</Title>
          <Body style={styles.subtle}>Fresh grammar and conversation lessons, generated for you in minutes.</Body>
        </View>
        <View style={styles.actions}>
          <Button label="Continue with Google" disabled={signedIn} loading={loading === "google"} onPress={() => void run("google")} />
          {Platform.OS === "ios" ? <Button label="Continue with Apple" variant="secondary" disabled={signedIn} loading={loading === "apple"} onPress={() => void run("apple")} /> : null}
          {error ? <Body style={{ color: theme.danger }}>{error}</Body> : null}
          <Body style={styles.terms}>By continuing, you agree to Resolingo’s Terms and Privacy Policy.</Body>
        </View>
      </Screen>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 }, screen: { justifyContent: "space-between", paddingTop: 50, paddingBottom: 36 },
  hero: { gap: 20 }, logo: { width: 104, height: 104, borderRadius: 26 }, white: { color: "#FFFFFF", fontSize: 40, lineHeight: 46 },
  subtle: { color: "#C9D6EC", fontSize: 18, lineHeight: 27 }, actions: { gap: 12 }, terms: { color: "#9FB0CC", fontSize: 12, lineHeight: 18, textAlign: "center" },
});
