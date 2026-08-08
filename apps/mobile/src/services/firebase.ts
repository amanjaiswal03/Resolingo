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

let initialized = false;

export async function initializeFirebaseSecurity(): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (process.env.EXPO_PUBLIC_USE_EMULATORS === "true") {
    connectAuthEmulator(firebaseAuth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }
  await initializeAppCheck(firebaseApp, {
    provider: {
      providerOptions: {
        android: { provider: __DEV__ ? "debug" : "playIntegrity" },
        apple: { provider: __DEV__ ? "debug" : "appAttestWithDeviceCheckFallback" },
      },
    },
    isTokenAutoRefreshEnabled: true,
  });
}
