import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api } from "./api";
import { firebaseAuth } from "./firebase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let registrationGeneration = 0;
let registrationEnabled = true;
let inFlight: Promise<void> | null = null;

export function cancelPushRegistration(): void {
  registrationEnabled = false;
  registrationGeneration += 1;
  inFlight = null;
  void Notifications.setAutoServerRegistrationEnabledAsync(false).catch(() => undefined);
}

export async function registerForPush(): Promise<void> {
  registrationEnabled = true;
  if (!firebaseAuth.currentUser) return;
  if (inFlight) return inFlight;
  const generation = registrationGeneration;
  const pending = performRegistration(generation).finally(() => {
    if (inFlight === pending) inFlight = null;
  });
  inFlight = pending;
  return pending;
}

async function performRegistration(generation: number): Promise<void> {
  try {
    if (!Device.isDevice || generation !== registrationGeneration) return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("lessons", { name: "Ready lessons", importance: Notifications.AndroidImportance.DEFAULT });
      await Notifications.setNotificationChannelAsync("reminders", { name: "Daily reminders", importance: Notifications.AndroidImportance.DEFAULT });
    }
    const current = await Notifications.getPermissionsAsync();
    const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!permission.granted || !firebaseAuth.currentUser || generation !== registrationGeneration) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId || projectId.startsWith("REPLACE")) return;
    const nativeToken = await Notifications.getDevicePushTokenAsync();
    if (!firebaseAuth.currentUser || generation !== registrationGeneration) return;
    const expoToken = await Notifications.getExpoPushTokenAsync({ projectId, devicePushToken: nativeToken });
    if (!firebaseAuth.currentUser || generation !== registrationGeneration) return;
    await api.registerPushDevice({
      expoPushToken: expoToken.data,
      nativePushToken: String(nativeToken.data),
      platform: Platform.OS === "ios" ? "ios" : "android",
    });
  } catch (error) {
    if (generation !== registrationGeneration) return;
    if (__DEV__) console.warn("[notifications] Push registration failed", error);
  }
}

export function listenForPushTokenChanges(): Notifications.EventSubscription {
  return Notifications.addPushTokenListener(() => {
    if (!registrationEnabled || !firebaseAuth.currentUser) return;
    void registerForPush();
  });
}
