import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  CefrLevelSchema,
  ConversationSkillSchema,
  DailyPickSchema,
  LanguageIdSchema,
  LessonPlanSchema,
  languageById,
  parseGrammarMemory,
  planDailyPick,
  type DailyPick,
  type LanguageId,
  type PickHistoryItem,
} from "@resolingo/shared";
import { requireUid } from "./auth.js";
import { REGION } from "./config.js";
import { startDailyLesson } from "./callables.js";
import { dailyPickPath, learnerContextPath } from "./context.js";
import { db } from "./firebase.js";
import { localDate } from "./time.js";

const HISTORY_SIZE = 20;

async function pickHistory(uid: string, targetLanguage: LanguageId): Promise<PickHistoryItem[]> {
  const snapshot = await db.collection(`users/${uid}/lessons`).orderBy("createdAt", "desc").limit(HISTORY_SIZE).get();
  return snapshot.docs.flatMap((doc) => {
    const data = doc.data();
    if (data.status !== "ready") return [];
    if (data.targetLanguage && data.targetLanguage !== targetLanguage) return [];
    const type = data.type === "conversation" || data.type === "grammar" || data.type === "phrase" ? data.type : undefined;
    if (!type) return [];
    const skill = ConversationSkillSchema.safeParse(data.conversationSkill);
    const plan = LessonPlanSchema.safeParse(data.plan);
    return [{
      type,
      ...(skill.success ? { conversationSkill: skill.data } : {}),
      ...(typeof data.ruleId === "string" ? { ruleId: data.ruleId } : {}),
      ...(typeof data.topic === "string" && data.topic ? { topic: data.topic } : {}),
      ...(plan.success && plan.data.kind === "welcome" ? { welcome: true } : {}),
    }];
  });
}

async function topics(uid: string, key: string): Promise<string[]> {
  const snapshot = await db.doc(`users/${uid}/recentTopics/${key}`).get();
  const value = snapshot.data()?.topics;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
}

/**
 * Returns today's lesson of the day, planning it on the first call of the
 * learner's day. Only the topic is planned; nothing is generated until the
 * learner taps it. The one exception is a brand-new learner's welcome lesson,
 * which starts generating straight away so it is ready sooner.
 */
export const getLessonOfTheDay = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  const uid = requireUid(request);
  const profile = (await db.doc(`users/${uid}`).get()).data();
  if (!profile?.onboardingComplete) throw new HttpsError("failed-precondition", "Complete onboarding first.");
  const targetLanguage = LanguageIdSchema.parse(profile.targetLanguage);
  const level = CefrLevelSchema.parse(profile.level);
  const date = localDate(profile.timezone as string);
  const pickRef = db.doc(dailyPickPath(uid, date));

  const snapshot = await pickRef.get();
  const existing = DailyPickSchema.safeParse(snapshot.data());
  // A pick made before the learner changed language or level is planned again.
  const fits = (data: Record<string, unknown> | undefined, pick: DailyPick) => pick.level === level && data?.targetLanguage === targetLanguage;
  if (existing.success && fits(snapshot.data(), existing.data) && (existing.data.kind !== "welcome" || existing.data.lessonId)) {
    return { pick: existing.data };
  }

  const [history, recentGrammar, recentConversation, context] = await Promise.all([
    pickHistory(uid, targetLanguage),
    topics(uid, `${targetLanguage}-grammar`),
    topics(uid, `${targetLanguage}-conversation`),
    db.doc(learnerContextPath(uid, targetLanguage)).get(),
  ]);
  const planned = planDailyPick({
    date,
    level,
    targetLanguage,
    targetLabel: languageById[targetLanguage].label.replace(/\s*\(.*\)$/u, ""),
    history,
    recentGrammar,
    recentConversation,
    lastGrammarTitle: parseGrammarMemory(context.data()?.grammar)?.title,
    welcomeDone: typeof profile.lastLessonDate === "string" || typeof profile.welcomeLessonId === "string",
  });

  // Two quick calls must not plan two different lessons for one day.
  const pick = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(pickRef);
    const stored = DailyPickSchema.safeParse(current.data());
    if (stored.success && fits(current.data(), stored.data)) return stored.data;
    // Keep a lesson the learner already started today, even if the plan changed.
    const keep = stored.success && stored.data.lessonId ? stored.data : undefined;
    const next: DailyPick = keep ?? planned;
    transaction.set(pickRef, { ...next, targetLanguage, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return next;
  });

  if (pick.kind === "welcome" && !pick.lessonId) {
    try {
      const started = await startDailyLesson(uid, { type: pick.type, lessonId: randomUUID(), lessonOfTheDay: true });
      return { pick: { ...pick, lessonId: started.lessonId } };
    } catch (error) {
      // The card still offers to start it, so this is not fatal.
      logger.warn("welcome_lesson_not_started", { message: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { pick };
});
