const DAILY_LESSON_CAP = 3;

export function dailyQuotaLabel(used: number, unlimitedLessons: boolean): string {
  if (unlimitedLessons) return "Unlimited";
  return `${used}/${DAILY_LESSON_CAP} lessons ready today · ${DAILY_LESSON_CAP - used} remaining`;
}

/** The in-progress lesson lock is separate; this is only the daily cap. */
export function dailyCapBlocksStart(used: number, unlimitedLessons: boolean): boolean {
  return !unlimitedLessons && used >= DAILY_LESSON_CAP;
}
