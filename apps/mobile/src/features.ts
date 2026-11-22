import type { LessonType } from "@resolingo/shared";

/**
 * "How would you say" stays in the app, but it is hidden until this is true.
 * That covers the Today card, the Say screens, phrase lessons in lists, and the Skills Saved tab.
 */
export const HOW_WOULD_YOU_SAY_ENABLED = false;

export function showHowWouldYouSayLesson(type: LessonType): boolean {
  return HOW_WOULD_YOU_SAY_ENABLED || type !== "phrase";
}
