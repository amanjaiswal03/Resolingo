const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type DatedLesson = { quotaDate: string; createdAt: string };

export type LessonDateGroup<T> = { date: string; label: string; lessons: T[] };

export function calendarDateInZone(zone: string, now = new Date()): string {
  const resolved = zone || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: resolved, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    if (resolved === "UTC") return now.toISOString().slice(0, 10);
    return calendarDateInZone("UTC", now);
  }
}

/** The day the lesson counts toward, which is already the learner's local date. */
export function lessonCalendarDate(lesson: DatedLesson): string {
  if (DAY.test(lesson.quotaDate)) return lesson.quotaDate;
  const created = lesson.createdAt.slice(0, 10);
  return DAY.test(created) ? created : "unknown";
}

function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  if (year == null || month == null || date == null) return day;
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

export function lessonDateLabel(day: string, today: string, locale?: string): string {
  if (day === today) return "Today";
  if (DAY.test(today) && day === shiftDay(today, -1)) return "Yesterday";
  if (!DAY.test(day)) return "Earlier";
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** Newest day first, and newest lesson first inside that day. */
export function groupLessonsByDate<T extends DatedLesson>(lessons: readonly T[], today: string, locale?: string): LessonDateGroup<T>[] {
  const sorted = [...lessons].sort((left, right) => {
    const byDay = lessonCalendarDate(right).localeCompare(lessonCalendarDate(left));
    if (byDay !== 0) return byDay;
    return right.createdAt.localeCompare(left.createdAt);
  });
  const groups: LessonDateGroup<T>[] = [];
  for (const lesson of sorted) {
    const date = lessonCalendarDate(lesson);
    const current = groups[groups.length - 1];
    if (current?.date === date) current.lessons.push(lesson);
    else groups.push({ date, label: lessonDateLabel(date, today, locale), lessons: [lesson] });
  }
  return groups;
}
