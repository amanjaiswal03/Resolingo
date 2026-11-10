import { getApp } from "@react-native-firebase/app";
import { getAuth, connectAuthEmulator } from "@react-native-firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "@react-native-firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "@react-native-firebase/functions";
import { getStorage, connectStorageEmulator } from "@react-native-firebase/storage";
import { initializeAppCheck } from "@react-native-firebase/app-check";

export const firebaseApp = getApp();
export const firebaseAuth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, "europe-west1");
export const storage = getStorage(firebaseApp);

let securityInit: Promise<void> | undefined;

export function initializeFirebaseSecurity(): Promise<void> {
  securityInit ??= startFirebaseSecurity().catch((error: unknown) => {
    securityInit = undefined;
    throw error;
  });
  return securityInit;
}

async function startFirebaseSecurity(): Promise<void> {
  if (process.env.EXPO_PUBLIC_USE_EMULATORS === "true") {
    connectAuthEmulator(firebaseAuth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }
  const debugToken = __DEV__ ? process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN?.trim() : "";
  await initializeAppCheck(firebaseApp, {
    provider: {
      providerOptions: {
        android: debugToken
          ? { provider: "debug", debugToken }
          : { provider: __DEV__ ? "debug" : "playIntegrity" },
        apple: debugToken
          ? { provider: "debug", debugToken }
          : { provider: __DEV__ ? "debug" : "appAttestWithDeviceCheckFallback" },
      },
    },
    isTokenAutoRefreshEnabled: true,
  });
}
