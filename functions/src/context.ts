import {
  LanguageIdSchema,
  MAX_PROMPT_KNOWN,
  parseConversationMemory,
  parseGrammarMemory,
  type LanguageId,
  type LearnerContext,
} from "@resolingo/shared";
import type { DocumentData } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "./firebase.js";

const MAX_READ_ITEMS = 80;

/** Admin SDK only: clients have no rule for this collection. */
export function learnerContextPath(uid: string, targetLanguage: LanguageId): string {
  return `users/${uid}/learnerContext/${targetLanguage}`;
}

/** Admin SDK only: clients read the lesson of the day through getLessonOfTheDay. */
export function dailyPickPath(uid: string, date: string): string {
  return `users/${uid}/dailyPicks/${date}`;
}

function knownFrom(docs: DocumentData[], language: LanguageId, nativeLanguage: LanguageId): LearnerContext["known"] {
  return docs
    .filter((data) => LanguageIdSchema.safeParse(data.language).data === language
      && LanguageIdSchema.safeParse(data.nativeLanguage).data === nativeLanguage)
    .filter((data) => typeof data.text === "string" && data.text.trim())
    .sort((left, right) => String(right.lastSeen ?? "").localeCompare(String(left.lastSeen ?? "")))
    .slice(0, MAX_PROMPT_KNOWN)
    .map((data) => ({
      text: String(data.text).trim(),
      ...(typeof data.translation === "string" && data.translation.trim() ? { translation: data.translation.trim() } : {}),
    }));
}

/**
 * Phrases from finished lessons and the last lesson of each type.
 * A read failure only means the lesson is planned without that history.
 */
export async function loadLearnerContext(uid: string, targetLanguage: LanguageId, nativeLanguage: LanguageId): Promise<LearnerContext> {
  try {
    const [items, memory] = await Promise.all([
      db.collection(`users/${uid}/reviewItems`).limit(MAX_READ_ITEMS).get(),
      db.doc(learnerContextPath(uid, targetLanguage)).get(),
    ]);
    const data = memory.data() ?? {};
    const lastGrammar = parseGrammarMemory(data.grammar);
    const lastConversation = parseConversationMemory(data.conversation);
    return {
      known: knownFrom(items.docs.map((doc) => doc.data()), targetLanguage, nativeLanguage),
      ...(lastGrammar ? { lastGrammar } : {}),
      ...(lastConversation ? { lastConversation } : {}),
    };
  } catch (error) {
    logger.warn("learner_context_unavailable", { uid, error: error instanceof Error ? error.message : "unknown" });
    return { known: [] };
  }
}
