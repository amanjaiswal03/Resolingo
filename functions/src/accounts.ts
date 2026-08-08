import { FieldValue } from "firebase-admin/firestore";
import * as functionsV1 from "firebase-functions/v1";
import { REGION } from "./config.js";
import { db } from "./firebase.js";

// Firebase Auth user lifecycle triggers are currently exposed through the v1 API.
// All lesson and preference APIs use Functions v2.
export const createUserProfile = functionsV1
  .region(REGION)
  .auth.user()
  .onCreate(async (user) => {
    const profileRef = db.doc(`users/${user.uid}`);
    await db.runTransaction(async (transaction) => {
      if ((await transaction.get(profileRef)).exists) return;
      transaction.create(profileRef, {
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        onboardingComplete: false,
        telemetryConsent: false,
        reminderEnabled: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  });
