import { z } from "zod";

export const ConversationSkillSchema = z.enum([
  "meet-people", "ask-for-help", "order-food", "get-around", "shop-and-pay",
  "make-plans", "handle-appointments", "everyday",
]);
export type ConversationSkill = z.infer<typeof ConversationSkillSchema>;

export const conversationSkills: Record<ConversationSkill, string> = {
  "meet-people": "Meet people and make small talk",
  "ask-for-help": "Ask for help and clarification",
  "order-food": "Order food and drinks",
  "get-around": "Get around and ask for directions",
  "shop-and-pay": "Shop and pay",
  "make-plans": "Make and change plans",
  "handle-appointments": "Handle appointments and services",
  everyday: "Use everyday expressions",
};
