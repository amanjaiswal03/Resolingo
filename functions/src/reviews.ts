import {
  LanguageIdSchema,
  phrasesToRemember,
  reviewAsPhrase,
  reviewItemId,
  selectDueReviews,
  touchReview,
  type LanguageId,
  type LessonSegment,
  type PimsleurPhrase,
  type ReviewItem,
  type SpeakerNames,
} from "@resolingo/shared";
import type { DocumentData } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "./firebase.js";

const MAX_STORED_ITEMS = 80;

function asItem(id: string, value: DocumentData): ReviewItem | null {
  const text = typeof value.text === "string" ? value.text.trim() : "";
  const translation = typeof value.translation === "string" ? value.translation.trim() : "";
  const language = LanguageIdSchema.safeParse(value.language);
  const nativeLanguage = LanguageIdSchema.safeParse(value.nativeLanguage);
  const dueAt = typeof value.dueAt === "string" ? value.dueAt : "";
  if (!text || !translation || !language.success || !nativeLanguage.success || Number.isNaN(Date.parse(dueAt))) return null;
  const speaker = value.speaker === "speakerB" ? "speakerB" : "speakerA";
  const ruleId = typeof value.ruleId === "string" ? value.ruleId.trim() : "";
  return {
    id,
    text,
    translation,
    language: language.data,
    nativeLanguage: nativeLanguage.data,
    speaker,
    ...(ruleId ? { ruleId } : {}),
    strength: Number.isFinite(value.strength) ? Number(value.strength) : 1,
    intervalDays: Number.isFinite(value.intervalDays) ? Number(value.intervalDays) : 1,
    lastSeen: typeof value.lastSeen === "string" ? value.lastSeen : dueAt,
    dueAt,
  };
}

/** Due phrases from earlier lessons. No history, or a read error, just means a normal lesson. */
export async function loadDueReviewPhrases(
  uid: string,
  language: LanguageId,
  nativeLanguage: LanguageId,
  now = Date.now(),
): Promise<PimsleurPhrase[]> {
  try {
    const snapshot = await db.collection(`users/${uid}/reviewItems`).limit(MAX_STORED_ITEMS).get();
    const items = snapshot.docs.flatMap((doc) => {
      const item = asItem(doc.id, doc.data());
      return item ? [item] : [];
    });
    return selectDueReviews(items, now, language, nativeLanguage, 3).map(reviewAsPhrase);
  } catch (error) {
    logger.warn("review_items_unavailable", { uid, error: error instanceof Error ? error.message : "unknown" });
    return [];
  }
}

/**
 * Remember the phrases a finished lesson actually drilled.
 * Writes stay on the admin SDK. Clients cannot read or write this collection.
 */
export async function recordLessonReviews(uid: string, lessonId: string): Promise<void> {
  const lessonRef = db.doc(`users/${uid}/lessons/${lessonId}`);
  const userRef = db.doc(`users/${uid}`);
  const [lessonSnap, userSnap] = await Promise.all([lessonRef.get(), userRef.get()]);
  const lesson = lessonSnap.data();
  const user = userSnap.data();
  if (!lesson || lesson.reviewsRecorded === true || lesson.completed !== true) return;
  const target = LanguageIdSchema.safeParse(user?.targetLanguage);
  const native = LanguageIdSchema.safeParse(user?.nativeLanguage);
  if (!target.success || !native.success) return;
  const names = lesson.speakerNames as SpeakerNames | undefined;
  if (!names?.teacher || !names.speakerA || !names.speakerB) return;
  const segments = Array.isArray(lesson.segments) ? lesson.segments as LessonSegment[] : [];
  const seen = phrasesToRemember(segments, names, target.data);
  if (seen.length === 0) {
    await lessonRef.set({ reviewsRecorded: true }, { merge: true });
    return;
  }
  const now = Date.now();
  const ruleId = lesson.type === "grammar" && typeof lesson.ruleId === "string" ? lesson.ruleId.trim() : "";
  const collection = db.collection(`users/${uid}/reviewItems`);
  const refs = seen.map((phrase) => collection.doc(reviewItemId(target.data, phrase.text)));
  const existing = await db.getAll(...refs);
  const batch = db.batch();
  seen.forEach((phrase, index) => {
    const current = existing[index]?.data();
    const item = touchReview(current ? asItem(refs[index]!.id, current) ?? undefined : undefined, {
      text: phrase.text,
      translation: phrase.translation,
      language: target.data,
      nativeLanguage: native.data,
      speaker: phrase.speaker,
      ...(ruleId ? { ruleId } : {}),
    }, now);
    batch.set(refs[index]!, item);
  });
  batch.set(lessonRef, { reviewsRecorded: true }, { merge: true });
  await batch.commit();
  const stored = await collection.limit(MAX_STORED_ITEMS + seen.length).get();
  if (stored.size <= MAX_STORED_ITEMS) return;
  const freshIds = new Set(refs.map((ref) => ref.id));
  const extras = stored.docs
    .filter((doc) => !freshIds.has(doc.id))
    .map((doc) => ({ doc, due: Date.parse(typeof doc.data().dueAt === "string" ? doc.data().dueAt : "") }))
    .sort((left, right) => right.due - left.due)
    .slice(0, stored.size - MAX_STORED_ITEMS);
  const trim = db.batch();
  for (const extra of extras) trim.delete(extra.doc.ref);
  await trim.commit();
}
