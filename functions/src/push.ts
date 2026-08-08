import { createHash } from "node:crypto";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { FieldValue } from "firebase-admin/firestore";
import { EXPO_ACCESS_TOKEN } from "./config.js";
import { db } from "./firebase.js";

const expo = () => new Expo({ accessToken: EXPO_ACCESS_TOKEN.value(), useFcmV1: true });

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function sendUserPush(
  uid: string,
  notification: Omit<ExpoPushMessage, "to">,
): Promise<void> {
  const devices = await db.collection(`users/${uid}/devices`).get();
  const validDevices = devices.docs.filter((document) => {
    const token = document.data().expoPushToken as string | undefined;
    return Boolean(token) && Expo.isExpoPushToken(token);
  });
  if (!validDevices.length) return;
  const client = expo();
  for (const device of validDevices) {
    const to = device.data().expoPushToken as string;
    const [ticket] = await client.sendPushNotificationsAsync([{ to, sound: "default", ...notification }]);
    if (!ticket) continue;
    if (ticket.status === "error") {
      if (ticket.details?.error === "DeviceNotRegistered") await device.ref.delete();
      else await device.ref.set({ lastDeliveryState: ticket.details?.error ?? "error" }, { merge: true });
    } else {
      await db.doc(`pushReceipts/${ticket.id}`).set({
        uid,
        deviceId: device.id,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }
  await Promise.all(devices.docs.map((document) => document.ref.set({ lastDeliveryAttemptAt: FieldValue.serverTimestamp() }, { merge: true })));
}
