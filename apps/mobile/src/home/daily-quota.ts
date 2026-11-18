const DAILY_LESSON_CAP = 3;

export function dailyQuotaLabel(used: number, unlimitedLessons: boolean): string {
  if (unlimitedLessons) return "Unlimited";
  return `${used}/${DAILY_LESSON_CAP} lessons ready today · ${DAILY_LESSON_CAP - used} remaining`;
}

/** The in-progress lesson lock is separate; this is only the daily cap. */
export function dailyCapBlocksStart(used: number, unlimitedLessons: boolean): boolean {
  return !unlimitedLessons && used >= DAILY_LESSON_CAP;
}

/**
 * Deleting a lesson must not look like a free slot. The server stores the
 * day's ready count and never decrements it; hidden rows are still counted
 * until that recorded count is the higher number.
 */
export function lessonsReadyToday(visibleReadyToday: number, heldReadyToday: number, recordedReadyCount: number): number {
  const visible = Math.max(0, visibleReadyToday) + Math.max(0, heldReadyToday);
  const recorded = Number.isFinite(recordedReadyCount) ? Math.max(0, recordedReadyCount) : 0;
  return Math.max(visible, recorded);
}
