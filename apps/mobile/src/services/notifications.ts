import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function registerForPush(): Promise<void> {
  if (!Device.isDevice) return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("lessons", { name: "Ready lessons", importance: Notifications.AndroidImportance.DEFAULT });
    await Notifications.setNotificationChannelAsync("reminders", { name: "Daily reminders", importance: Notifications.AndroidImportance.DEFAULT });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId || projectId.startsWith("REPLACE")) return;
  const [expoToken, nativeToken] = await Promise.all([
    Notifications.getExpoPushTokenAsync({ projectId }),
    Notifications.getDevicePushTokenAsync(),
  ]);
  await api.registerPushDevice({
    expoPushToken: expoToken.data,
    nativePushToken: String(nativeToken.data),
    platform: Platform.OS === "ios" ? "ios" : "android",
  });
}

export function listenForPushTokenChanges(): Notifications.EventSubscription {
  return Notifications.addPushTokenListener(() => {
    void registerForPush();
  });
}
