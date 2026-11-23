import { describe, expect, it } from "vitest";
import {
  chooseConversationSkill,
  chooseDailyType,
  chooseScene,
  DailyPickSchema,
  grammarTopicById,
  planDailyPick,
  planFromPick,
  type PickHistoryItem,
} from "./lesson-of-the-day.js";
import { normalizeSpeakerNames } from "./speakers.js";
import { welcomeIntro } from "./pimsleur.js";

const base = {
  date: "2026-11-24",
  level: "A1" as const,
  targetLanguage: "de-DE" as const,
  targetLabel: "German",
  recentGrammar: [],
  recentConversation: [],
};

describe("lesson of the day planner", () => {
  it("gives a brand-new learner a welcome lesson in a meet-people scene", () => {
    const pick = planDailyPick({ ...base, history: [], welcomeDone: false });
    expect(pick.kind).toBe("welcome");
    expect(pick.type).toBe("conversation");
    expect(pick.conversationSkill).toBe("meet-people");
    expect(pick.title).toBe("Your first German lesson");
    expect(DailyPickSchema.safeParse(pick).success).toBe(true);
  });

  it("does not offer a welcome lesson to a learner who has had lessons", () => {
    expect(planDailyPick({ ...base, history: [], welcomeDone: true }).kind).toBe("daily");
  });

  it("follows the welcome lesson with a first grammar point", () => {
    const history: PickHistoryItem[] = [{ type: "conversation", conversationSkill: "meet-people", welcome: true }];
    const pick = planDailyPick({ ...base, history, welcomeDone: true });
    expect(pick.type).toBe("grammar");
    expect(pick.reason).toBe("first-grammar");
    expect(pick.ruleId).toBe("de-sein");
    expect(pick.title).toBe("Present tense of sein");
  });

  it("puts a new grammar point to work in the next conversation", () => {
    const history: PickHistoryItem[] = [{ type: "grammar", ruleId: "de-sein", topic: "Present tense of sein" }, { type: "conversation", conversationSkill: "meet-people" }];
    const pick = planDailyPick({ ...base, history, welcomeDone: true, lastGrammarTitle: "Present tense of sein" });
    expect(pick.type).toBe("conversation");
    expect(pick.reason).toBe("use-grammar");
    expect(pick.why).toBe("Puts Present tense of sein to work in a real exchange");
    expect(pick.conversationSkill).toBe("order-food");
    expect(pick.title).toBe(pick.scenario);
  });

  it("brings the next grammar point after two conversations, skipping what was learned", () => {
    const history: PickHistoryItem[] = [
      { type: "conversation", conversationSkill: "order-food" },
      { type: "phrase" },
      { type: "conversation", conversationSkill: "meet-people" },
      { type: "grammar", ruleId: "de-sein", topic: "Present tense of sein" },
    ];
    expect(chooseDailyType(history)).toEqual({ type: "grammar", reason: "next-grammar" });
    const pick = planDailyPick({ ...base, history, welcomeDone: true });
    expect(pick.ruleId).toBe("de-haben");
    expect(pick.why).toBe("Builds on Present tense of sein");
  });

  it("answers a learner's own lessons: grammar after their grammar becomes a conversation", () => {
    expect(chooseDailyType([{ type: "grammar" }, { type: "grammar" }]).type).toBe("conversation");
    expect(chooseDailyType([{ type: "conversation" }, { type: "grammar" }])).toEqual({ type: "conversation", reason: "balance" });
  });

  it("rotates to the conversation goal practised least recently", () => {
    const skills = ["meet-people", "order-food", "get-around", "ask-for-help", "shop-and-pay", "make-plans", "handle-appointments"] as const;
    const history: PickHistoryItem[] = skills.map((skill) => ({ type: "conversation", conversationSkill: skill }));
    expect(chooseConversationSkill(history)).toBe("handle-appointments");
    expect(chooseConversationSkill(history.slice(0, 3))).toBe("ask-for-help");
  });

  it("picks a level-fitting scene that is stable for the day and avoids recent topics", () => {
    const first = chooseScene("order-food", "A1", "2026-11-24", []);
    expect(chooseScene("order-food", "A1", "2026-11-24", [])).toBe(first);
    expect(chooseScene("order-food", "A1", "2026-11-24", [first])).not.toBe(first);
    expect(chooseScene("order-food", "B2", "2026-11-24", [])).not.toMatch(/^Order a coffee to take away$/u);
  });

  it("finds a planned grammar point even after a level change", () => {
    expect(grammarTopicById("de-DE", "B1", "de-sein")?.title).toBe("Present tense of sein");
    expect(grammarTopicById("de-DE", "A1", "missing")).toBeUndefined();
  });

  it("carries only the plan fields onto the lesson", () => {
    const pick = planDailyPick({ ...base, history: [], welcomeDone: false });
    expect(planFromPick(pick)).toEqual({ kind: "welcome", date: "2026-11-24", scenario: pick.scenario, conversationSkill: "meet-people" });
  });
});

describe("welcome intro", () => {
  it("keeps up to four single sentences and drops anything else", () => {
    const names = normalizeSpeakerNames({ teacher: "Mia", speakerA: "Leo", speakerB: "Ana" });
    const lines = welcomeIntro(["Welcome to Resolingo. Extra sentence.", 4, "Each lesson is short audio.", "Speak at every pause.", "Lessons build on each other.", "One too many."], names);
    expect(lines).toEqual(["Welcome to Resolingo.", "Each lesson is short audio.", "Speak at every pause.", "Lessons build on each other."]);
    expect(welcomeIntro("not a list", names)).toEqual([]);
  });
});
