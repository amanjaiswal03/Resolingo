import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { getStorage } from "firebase-admin/storage";

initializeApp();

export const auth = getAuth();
export const db = getFirestore();
export const adminFunctions = getFunctions();
export const bucket = getStorage().bucket();
