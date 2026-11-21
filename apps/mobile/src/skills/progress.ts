import { collection, doc, onSnapshot, runTransaction } from "@react-native-firebase/firestore";
import { firestore } from "@/services/firebase";
import { languagePairKey, progressForCard, scheduleReview, type LanguagePair, type ProgressByCard, type ReviewMode, type ReviewProgress, type ReviewRating, type SkillCard } from "./model";

function isRating(value: unknown): value is ReviewRating {
  return value === "got-it" || value === "almost" || value === "forgot";
}

function parseProgress(value: unknown): ReviewProgress | undefined {
  if (!value || typeof value !== "object") return;
  const data = value as Partial<ReviewProgress>;
  if (typeof data.attemptId !== "string" || !isRating(data.lastRating) ||
      (data.lastMode !== "recall" && data.lastMode !== "recognition") ||
      (data.recallRating !== null && !isRating(data.recallRating)) ||
      typeof data.reviewedAt !== "number" || !Number.isSafeInteger(data.reviewedAt) ||
      typeof data.dueAt !== "number" || !Number.isSafeInteger(data.dueAt) ||
      typeof data.intervalDays !== "number" || !Number.isInteger(data.intervalDays) ||
      data.intervalDays < 1 || data.intervalDays > 32) return;
  return {
    attemptId: data.attemptId,
    lastRating: data.lastRating,
    lastMode: data.lastMode,
    recallRating: data.recallRating,
    reviewedAt: data.reviewedAt,
    dueAt: data.dueAt,
    intervalDays: data.intervalDays,
  };
}

export function subscribeSkillProgress(uid: string, pair: LanguagePair, receive: (state: ProgressByCard) => void, onError: (error: Error) => void): () => void {
  const reviews = collection(firestore, "users", uid, "skillReviews", languagePairKey(pair), "items");
  return onSnapshot(reviews, (snapshot) => {
    const reviews: ProgressByCard = {};
    for (const entry of snapshot.docs) {
      const item = parseProgress(entry.data());
      if (item) reviews[entry.id] = item;
    }
    receive(reviews);
  }, onError);
}

export function recordSkillReview(uid: string, pair: LanguagePair, card: SkillCard, input: {
  attemptId: string; mode: ReviewMode; rating: ReviewRating; now: number;
}): Promise<ReviewProgress> {
  const items = collection(firestore, "users", uid, "skillReviews", languagePairKey(pair), "items");
  const reference = doc(items, card.id);
  return runTransaction(firestore, async (transaction) => {
    const records: ProgressByCard = {};
    const ids = [card.id, ...(card.previousIds ?? [])];
    await Promise.all(ids.map(async (id) => {
      const progress = parseProgress((await transaction.get(doc(items, id))).data());
      if (progress) records[id] = progress;
    }));
    const previous = progressForCard(card, records);
    if (previous && (previous.attemptId === input.attemptId || previous.reviewedAt > input.now)) return previous;
    const updated = scheduleReview(previous, input);
    transaction.set(reference, updated);
    return updated;
  });
}
