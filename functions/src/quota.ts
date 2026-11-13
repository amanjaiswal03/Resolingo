export function withoutReservation(reservations: unknown, lessonId: string | undefined): string[] {
  if (!Array.isArray(reservations)) return [];
  return reservations.filter((id): id is string => typeof id === "string" && id !== lessonId);
}

export function quotaUsed(readyCount: number, reservations: readonly string[]): number {
  return Math.max(0, readyCount) + new Set(reservations).size;
}

/** Cap for one new reservation. Infinity skips the daily cap and still records the slot. */
export function dailyReservationLimit(unlimitedLessons: unknown, dailyLimit: number): number {
  return unlimitedLessons === true ? Number.POSITIVE_INFINITY : dailyLimit;
}

export function reserveLesson(
  readyCount: number,
  reservations: readonly string[],
  lessonId: string,
  limit: number,
): string[] {
  const unique = [...new Set(reservations)];
  if (unique.includes(lessonId)) return unique;
  if (quotaUsed(readyCount, unique) >= limit) throw new Error("DAILY_LIMIT_REACHED");
  return [...unique, lessonId];
}
