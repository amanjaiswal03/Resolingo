import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

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
});
