export function quotaUsed(readyCount: number, reservations: readonly string[]): number {
  return Math.max(0, readyCount) + new Set(reservations).size;
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
