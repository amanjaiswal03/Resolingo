import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { AppleAuthProvider, GoogleAuthProvider, signInWithCredential, signOut } from "@react-native-firebase/auth";
import { firebaseAuth } from "./firebase";
import { cancelPushRegistration } from "./notifications";

const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  ...(iosClientId ? { iosClientId } : {}),
});

export async function signInWithGoogle(): Promise<void> {
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await GoogleSignin.signIn();
  const data = (result as { data?: { idToken?: string | null }; idToken?: string | null });
  const idToken = data.data?.idToken ?? data.idToken;
  if (!idToken) throw new Error("Google did not return an ID token.");
  await signInWithCredential(firebaseAuth, GoogleAuthProvider.credential(idToken));
}

export async function signInWithApple(): Promise<void> {
  if (Platform.OS !== "ios") throw new Error("Apple sign-in is only available on iOS.");
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce, { encoding: Crypto.CryptoEncoding.HEX });
  const result = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    nonce: hashedNonce,
  });
  if (!result.identityToken) throw new Error("Apple did not return an identity token.");
  await signInWithCredential(firebaseAuth, AppleAuthProvider.credential(result.identityToken, rawNonce));
}

export async function logOut(): Promise<void> {
  cancelPushRegistration();
  await Promise.allSettled([GoogleSignin.signOut(), signOut(firebaseAuth)]);
}
