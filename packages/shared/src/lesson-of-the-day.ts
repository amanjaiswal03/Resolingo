import { z } from "zod";
import { conversationSkills, type ConversationSkill } from "./conversation-skills.js";
import { grammarTopics, selectGrammarTopic, type GrammarTopic } from "./grammar.js";
import type { LanguageId } from "./languages.js";
import { CefrLevelSchema, DailyPickKindSchema, LessonPlanSchema, type CefrLevel, type LessonPlan } from "./schemas.js";

/**
 * The lesson of the day is planned before anything is generated: the server
 * picks a type and a topic, the home screen shows only that, and the lesson
 * itself is written when the learner taps the card. The very first pick for a
 * new learner is a welcome lesson, which is generated straight away.
 */

/** Why today's pick was chosen, so the card can say it in plain words. */
export const DailyPickReasonSchema = z.enum([
  "welcome", "use-grammar", "new-skill", "next-grammar", "first-grammar", "balance",
]);
export type DailyPickReason = z.infer<typeof DailyPickReasonSchema>;

export const DailyPickSchema = LessonPlanSchema.extend({
  type: z.enum(["conversation", "grammar"]),
  level: CefrLevelSchema,
  /** What the card shows as the topic, such as "Order a coffee to take away". */
  title: z.string().min(3).max(120),
  reason: DailyPickReasonSchema,
  /** One short line under the title, such as "Puts Present tense of sein to work". */
  why: z.string().min(3).max(160),
  /** Set once the learner starts the pick, or straight away for the welcome lesson. */
  lessonId: z.string().min(1).optional(),
});
export type DailyPick = z.infer<typeof DailyPickSchema>;

export const GetLessonOfTheDayResponseSchema = z.object({ pick: DailyPickSchema });

/** One earlier lesson, newest first, as the planner sees it. */
export type PickHistoryItem = {
  type: "conversation" | "grammar" | "phrase";
  conversationSkill?: ConversationSkill | undefined;
  ruleId?: string | undefined;
  topic?: string | undefined;
  welcome?: boolean | undefined;
};

type Band = "starter" | "growing";

/**
 * Everyday scenes for each conversation goal. The starter band is for A1 and A2,
 * the growing band for B1 and up, where each scene adds a small complication.
 */
const SCENES: Record<Exclude<ConversationSkill, "everyday">, Record<Band, string[]>> = {
  "meet-people": {
    starter: ["Introduce yourself to a new neighbour", "Say where you are from at a party", "Talk about your job with a classmate", "Chat about the weekend with a colleague"],
    growing: ["Keep a conversation going with someone you just met", "Explain what brought you to the city", "Swap recommendations with a new friend", "Catch up with an old friend you bump into"],
  },
  "ask-for-help": {
    starter: ["Ask someone to repeat more slowly", "Ask what a word means", "Ask a shop assistant where something is", "Ask for the Wi-Fi password"],
    growing: ["Explain a problem with your hotel room", "Ask a pharmacist for something for a cold", "Report a lost bag at the station", "Ask a colleague to explain a task again"],
  },
  "order-food": {
    starter: ["Order a coffee to take away", "Order lunch at a café", "Ask for the bill", "Buy bread at a bakery"],
    growing: ["Order with a food allergy", "Send back a dish that is wrong", "Book a table for a group", "Ask the waiter for a recommendation"],
  },
  "get-around": {
    starter: ["Ask the way to the station", "Buy a train ticket", "Take a taxi to your hotel", "Ask which bus goes to the centre"],
    growing: ["Change a train after a cancellation", "Ask for directions when you are lost", "Rent a bike for the day", "Explain to a driver that you missed your stop"],
  },
  "shop-and-pay": {
    starter: ["Ask how much something costs", "Pay by card at a market", "Ask for a different size", "Buy a few things at the supermarket"],
    growing: ["Return something that does not fit", "Ask for a discount on a damaged item", "Compare two phones with a salesperson", "Sort out a mistake on your receipt"],
  },
  "make-plans": {
    starter: ["Invite a friend for coffee", "Agree on a time to meet", "Plan a trip to the cinema", "Say you are running late"],
    growing: ["Move a dinner to another day", "Plan a weekend trip with a friend", "Turn down an invitation politely", "Agree on a plan when you disagree"],
  },
  "handle-appointments": {
    starter: ["Make a doctor's appointment", "Book a haircut", "Check in at a hotel", "Pick up a parcel at the post office"],
    growing: ["Explain your symptoms to a doctor", "Reschedule an appointment", "Report a problem to your landlord", "Open a bank account"],
  },
};

const SKILL_ORDER: Array<Exclude<ConversationSkill, "everyday">> = [
  "meet-people", "order-food", "get-around", "ask-for-help", "shop-and-pay", "make-plans", "handle-appointments",
];

const WELCOME_SCENARIO: Record<CefrLevel, string> = {
  A1: "Say hello, give your name, and say where you are from",
  A2: "Introduce yourself and say what you do",
  B1: "Introduce yourself and say why you are learning the language",
  B2: "Introduce yourself and talk about your plans with the language",
  C1: "Introduce yourself and hold a relaxed first conversation",
};

function band(level: CefrLevel): Band {
  return level === "A1" || level === "A2" ? "starter" : "growing";
}

/** A small stable hash, so a date always gives the same scene. */
function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

const same = (left: string, right: string) => left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

/**
 * Learn, then use it twice. A grammar point is followed by a conversation that
 * puts it to work, and after two conversations the next grammar point comes up.
 * Lessons the learner made themselves count too, so a learner who just did a
 * grammar lesson gets a conversation, and one who only makes conversations is
 * offered grammar. Level does not change the rhythm; it changes the topics.
 */
export function chooseDailyType(history: readonly PickHistoryItem[]): { type: "conversation" | "grammar"; reason: DailyPickReason } {
  const lessons = history.filter((item) => item.type !== "phrase");
  const latest = lessons[0];
  if (!latest) return { type: "conversation", reason: "new-skill" };
  if (latest.type === "grammar") return { type: "conversation", reason: "use-grammar" };
  const sinceGrammar = lessons.findIndex((item) => item.type === "grammar");
  const conversationsSince = sinceGrammar === -1 ? lessons.length : sinceGrammar;
  if (sinceGrammar === -1) return conversationsSince >= 1 ? { type: "grammar", reason: "first-grammar" } : { type: "conversation", reason: "new-skill" };
  if (conversationsSince >= 2) return { type: "grammar", reason: "next-grammar" };
  return { type: "conversation", reason: "balance" };
}

/** The conversation goal practised least recently, in a sensible order for new learners. */
export function chooseConversationSkill(history: readonly PickHistoryItem[]): Exclude<ConversationSkill, "everyday"> {
  const used = history.flatMap((item) => item.type === "conversation" && item.conversationSkill ? [item.conversationSkill] : []);
  const fresh = SKILL_ORDER.find((skill) => !used.includes(skill));
  if (fresh) return fresh;
  // Every goal has come up: take the one whose last use is oldest.
  return [...SKILL_ORDER].sort((left, right) => used.indexOf(right) - used.indexOf(left))[0]!;
}

export function chooseScene(skill: Exclude<ConversationSkill, "everyday">, level: CefrLevel, date: string, recentTopics: readonly string[]): string {
  const scenes = SCENES[skill][band(level)];
  const start = hash(`${skill}|${date}`) % scenes.length;
  for (let offset = 0; offset < scenes.length; offset += 1) {
    const scene = scenes[(start + offset) % scenes.length]!;
    if (!recentTopics.some((topic) => same(topic, scene))) return scene;
  }
  return scenes[start]!;
}

/** Finds a planned grammar point by id, at the learner's level first. */
export function grammarTopicById(language: LanguageId, level: CefrLevel, ruleId: string): GrammarTopic | undefined {
  const levels = [level, ...CefrLevelSchema.options.filter((item) => item !== level)];
  for (const candidate of levels) {
    const found = grammarTopics(language, candidate).find((topic) => topic.id === ruleId);
    if (found) return found;
  }
  return undefined;
}

export function welcomePick(input: { date: string; level: CefrLevel; targetLabel: string }): DailyPick {
  return {
    kind: "welcome",
    date: input.date,
    type: "conversation",
    level: input.level,
    conversationSkill: "meet-people",
    scenario: WELCOME_SCENARIO[input.level],
    title: `Your first ${input.targetLabel} lesson`,
    reason: "welcome",
    why: "How Resolingo works, then your first real conversation",
  };
}

/**
 * Plans today's lesson from what the learner has done. Nothing is generated here.
 * history is newest first; recentGrammar and recentConversation are the stored
 * recent topics for this target language.
 */
export function planDailyPick(input: {
  date: string;
  level: CefrLevel;
  targetLanguage: LanguageId;
  targetLabel: string;
  history: readonly PickHistoryItem[];
  recentGrammar: readonly string[];
  recentConversation: readonly string[];
  /** The last grammar point taught, so the next conversation can say it uses it. */
  lastGrammarTitle?: string | undefined;
  welcomeDone: boolean;
}): DailyPick {
  if (!input.welcomeDone && input.history.length === 0) {
    return welcomePick({ date: input.date, level: input.level, targetLabel: input.targetLabel });
  }
  const { type, reason } = chooseDailyType(input.history);
  if (type === "grammar") {
    const learned = input.history.flatMap((item) => item.type === "grammar" ? [item.ruleId ?? item.topic ?? ""] : []).filter(Boolean);
    const topic = selectGrammarTopic({
      language: input.targetLanguage,
      level: input.level,
      recentTopics: [...learned, ...input.recentGrammar],
    });
    const builds = topic.prerequisites.at(-1);
    return {
      kind: "daily",
      date: input.date,
      type,
      level: input.level,
      ruleId: topic.id,
      title: topic.title,
      reason,
      why: reason === "first-grammar"
        ? "Your first grammar point, with the words you already know"
        : builds ? `Builds on ${builds}` : `The next step in your ${input.level} grammar`,
    };
  }
  const skill = chooseConversationSkill(input.history);
  const scene = chooseScene(skill, input.level, input.date, input.recentConversation);
  const grammar = input.lastGrammarTitle?.trim();
  return {
    kind: "daily",
    date: input.date,
    type,
    level: input.level,
    conversationSkill: skill,
    scenario: scene,
    title: scene,
    reason,
    why: reason === "use-grammar" && grammar
      ? `Puts ${grammar} to work in a real exchange`
      : `${conversationSkills[skill]}`,
  };
}

/** The plan that travels with a lesson started from a pick. */
export function planFromPick(pick: DailyPick): LessonPlan {
  return {
    kind: pick.kind,
    date: pick.date,
    ...(pick.scenario ? { scenario: pick.scenario } : {}),
    ...(pick.conversationSkill ? { conversationSkill: pick.conversationSkill } : {}),
    ...(pick.ruleId ? { ruleId: pick.ruleId } : {}),
  };
}
