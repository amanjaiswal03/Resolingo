import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { EXPO_ACCESS_TOKEN, REGION } from "./config.js";
import { bucket, db } from "./firebase.js";
import { Expo } from "expo-server-sdk";
import { sendUserPush } from "./push.js";
import { releaseReservation } from "./jobs.js";
import { localDate, nextReminderAt } from "./time.js";

export const dispatchReminders = onSchedule({
  region: REGION,
  schedule: "every 15 minutes",
  timeZone: "UTC",
  secrets: [EXPO_ACCESS_TOKEN],
}, async () => {
  const due = await db.collection("users")
    .where("reminderEnabled", "==", true)
    .where("reminderNextAt", "<=", Timestamp.now())
    .limit(500)
    .get();
  await Promise.all(due.docs.map(async (userDocument) => {
    const user = userDocument.data();
    const quotaDate = localDate(user.timezone as string);
    const completed = await db.collection(`users/${userDocument.id}/lessons`)
      .where("quotaDate", "==", quotaDate)
      .where("completed", "==", true)
      .limit(1)
      .get();
    if (completed.empty) {
      await sendUserPush(userDocument.id, {
        title: "Your daily Resolingo lesson",
        body: "A few minutes today can move your language forward.",
        data: { path: "/", event: "reminder" },
        channelId: "reminders",
      });
      logger.info("reminder_delivery", {
        userIdHash: createHash("sha256").update(userDocument.id).digest("hex").slice(0, 12),
        quotaDate,
      });
    }
    await userDocument.ref.update({
      reminderNextAt: Timestamp.fromDate(nextReminderAt(user.timezone as string, user.reminderTime as string)),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }));
});

export const processPushReceipts = onSchedule({
  region: REGION,
  schedule: "every 15 minutes",
  timeZone: "UTC",
  secrets: [EXPO_ACCESS_TOKEN],
}, async () => {
  const pending = await db.collection("pushReceipts")
    .where("createdAt", "<", Timestamp.fromMillis(Date.now() - 5 * 60 * 1000))
    .limit(500)
    .get();
  if (pending.empty) return;
  const client = new Expo({ accessToken: EXPO_ACCESS_TOKEN.value(), useFcmV1: true });
  const receipts = await client.getPushNotificationReceiptsAsync(pending.docs.map((document) => document.id));
  await Promise.all(pending.docs.map(async (document) => {
    const receipt = receipts[document.id];
    const data = document.data();
    const deviceRef = db.doc(`users/${data.uid as string}/devices/${data.deviceId as string}`);
    if (receipt?.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
      await deviceRef.delete();
    } else if (receipt) {
      await deviceRef.set({
        lastDeliveryState: receipt.status === "ok" ? "ok" : receipt.details?.error ?? "error",
        lastReceiptAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await document.ref.delete();
  }));
});

export const cleanupAbandonedJobs = onSchedule({
  region: REGION,
  schedule: "every day 03:00",
  timeZone: "UTC",
}, async () => {
  const abandonedCutoff = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  const abandoned = await db.collectionGroup("lessons")
    .where("status", "in", ["queued", "generating_content", "synthesizing_audio"])
    .where("updatedAt", "<", abandonedCutoff)
    .limit(500)
    .get();
  await Promise.all(abandoned.docs.map(async (lesson) => {
    const uid = lesson.ref.parent.parent?.id;
    if (!uid) return;
    await lesson.ref.update({
      status: "failed",
      failureCode: "generation_timeout",
      progress: 0,
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await releaseReservation(uid, lesson.id, lesson.data().quotaDate as string);
  }));

  const cutoff = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const failed = await db.collectionGroup("lessons")
    .where("status", "==", "failed")
    .where("updatedAt", "<", cutoff)
    .limit(500)
    .get();
  await Promise.all(failed.docs.map(async (lesson) => {
    const uid = lesson.ref.parent.parent?.id;
    if (!uid) return;
    await bucket.deleteFiles({ prefix: `users/${uid}/lessons/${lesson.id}/` });
    await lesson.ref.delete();
  }));
});
