import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "resolingo-test",
    firestore: { rules: readFileSync(`${root}firestore.rules`, "utf8") },
    storage: { rules: readFileSync(`${root}storage.rules`, "utf8") },
  });
});

beforeEach(async () => env.clearFirestore());
afterAll(async () => env.cleanup());

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users/alice"), {
      nickname: "Alice",
      nativeLanguage: "en-US",
      targetLanguage: "de-DE",
      level: "A1",
      status: "server-only",
      updatedAt: new Date(),
    });
    await setDoc(doc(context.firestore(), "users/alice/lessons/lesson-1"), { status: "ready", completed: false, updatedAt: new Date() });
    await setDoc(doc(context.firestore(), "users/alice/reviewItems/item1"), { text: "Danke.", translation: "Thanks." });
    await setDoc(doc(context.firestore(), "users/alice/phrases/phrase_ab12cd34"), { nativeText: "Thanks", translation: "Danke." });
  });
}

describe("Firestore owner rules", () => {
  it("allows an owner read and denies another user", async () => {
    await seed();
    await assertSucceeds(getDoc(doc(env.authenticatedContext("alice").firestore(), "users/alice")));
    await assertFails(getDoc(doc(env.authenticatedContext("bob").firestore(), "users/alice")));
  });

  it("allows preferences but protects server-managed profile fields", async () => {
    await seed();
    const own = env.authenticatedContext("alice").firestore();
    await assertSucceeds(updateDoc(doc(own, "users/alice"), { nickname: "Ali", updatedAt: new Date() }));
    await assertFails(updateDoc(doc(own, "users/alice"), { status: "tampered", updatedAt: new Date() }));
    await assertFails(updateDoc(doc(own, "users/alice"), { unlimitedLessons: true }));
    await assertFails(updateDoc(doc(own, "users/alice"), { nickname: "Ali", unlimitedLessons: true, updatedAt: new Date() }));
  });

  it("lets the owner read a saved phrase and rejects client writes", async () => {
    await seed();
    const own = env.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(own, "users/alice/phrases/phrase_ab12cd34")));
    await assertFails(getDoc(doc(env.authenticatedContext("bob").firestore(), "users/alice/phrases/phrase_ab12cd34")));
    await assertFails(setDoc(doc(own, "users/alice/phrases/phrase_ffff0000"), { nativeText: "Hi", translation: "Hallo." }));
  });

  it("keeps learned phrases server-only", async () => {
    await seed();
    const own = env.authenticatedContext("alice").firestore();
    await assertFails(getDoc(doc(own, "users/alice/reviewItems/item1")));
    await assertFails(setDoc(doc(own, "users/alice/reviewItems/item2"), { text: "Bitte." }));
  });

  it("permits private Skills progress and rejects invalid schedules", async () => {
    const path = "users/alice/skillReviews/en-US_de-DE/items/0123456789abcdef";
    const owner = env.authenticatedContext("alice").firestore();
    const guest = env.authenticatedContext("bob").firestore();
    const alice = doc(owner, path);
    const bob = doc(guest, path);
    const items = "users/alice/skillReviews/en-US_de-DE/items";
    expect((await assertSucceeds(getDocs(collection(owner, items)))).empty).toBe(true);
    await assertFails(getDocs(collection(guest, items)));
    const reviewedAt = Date.now();
    const progress = {
      attemptId: "e266c7a8-cd2b-4b20-9179-3fec548b603d",
      lastRating: "forgot",
      lastMode: "recall",
      recallRating: "forgot",
      reviewedAt,
      dueAt: reviewedAt + 86_400_000,
      intervalDays: 1,
    };
    await assertSucceeds(setDoc(alice, progress));
    await assertSucceeds(getDoc(alice));
    expect((await assertSucceeds(getDocs(collection(owner, items)))).docs.map((entry) => entry.data())).toEqual([progress]);
    await assertFails(getDoc(bob));
    await assertFails(setDoc(bob, progress));
    await assertFails(updateDoc(alice, { recallRating: "got-it" }));
    await assertFails(updateDoc(alice, { dueAt: 0 }));
  });

  it("makes lessons available after completion and keeps synced review progress with its language pair", async () => {
    await seed();
    const device = env.authenticatedContext("alice").firestore();
    const otherDevice = env.authenticatedContext("alice", { device: "second" }).firestore();
    const completed = query(collection(otherDevice, "users/alice/lessons"), where("completed", "==", true), orderBy("updatedAt", "desc"));
    expect((await assertSucceeds(getDocs(completed))).empty).toBe(true);
    await assertSucceeds(updateDoc(doc(device, "users/alice/lessons/lesson-1"), { completed: true, updatedAt: new Date() }));
    expect((await assertSucceeds(getDocs(completed))).docs.map((lesson) => lesson.id)).toEqual(["lesson-1"]);

    const id = "0123456789abcdef";
    const reviewedAt = Date.now();
    const german = `users/alice/skillReviews/en-US_de-DE/items/${id}`;
    const spanish = `users/alice/skillReviews/en-US_es-ES/items/${id}`;
    await assertSucceeds(setDoc(doc(device, german), {
      attemptId: "e266c7a8-cd2b-4b20-9179-3fec548b603d",
      lastRating: "got-it", lastMode: "recall", recallRating: "got-it",
      intervalDays: 3, reviewedAt, dueAt: reviewedAt + 3 * 86_400_000,
    }));
    expect((await assertSucceeds(getDoc(doc(otherDevice, german)))).data()?.recallRating).toBe("got-it");
    expect((await assertSucceeds(getDoc(doc(otherDevice, spanish)))).exists()).toBe(false);
  });

  it("allows completion while denying lesson status changes", async () => {
    await seed();
    const lesson = doc(env.authenticatedContext("alice").firestore(), "users/alice/lessons/lesson-1");
    await assertSucceeds(updateDoc(lesson, { completed: true, updatedAt: new Date() }));
    await assertFails(updateDoc(lesson, { status: "failed", updatedAt: new Date() }));
  });
});

describe("Storage owner rules", () => {
  it("allows owner audio reads, denies other users, and denies client writes", async () => {
    const path = "users/alice/lessons/lesson-1/segments/segment-1.mp3";
    await env.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), path), new Uint8Array([1, 2, 3]));
    });
    await assertSucceeds(getBytes(ref(env.authenticatedContext("alice").storage(), path)));
    await assertFails(getBytes(ref(env.authenticatedContext("bob").storage(), path)));
    await assertFails(uploadBytes(ref(env.authenticatedContext("alice").storage(), path), new Uint8Array([4])));
  });

  it("allows the owner to read a phrase preview and rejects client writes", async () => {
    const path = "users/alice/phrases/phrase_ab12cd34/preview.wav";
    await env.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), path), new Uint8Array([1, 2, 3]));
    });
    await assertSucceeds(getBytes(ref(env.authenticatedContext("alice").storage(), path)));
    await assertFails(getBytes(ref(env.authenticatedContext("bob").storage(), path)));
    await assertFails(uploadBytes(ref(env.authenticatedContext("alice").storage(), path), new Uint8Array([4])));
  });
});
