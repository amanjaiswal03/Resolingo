import { DateTime } from "luxon";

export function assertTimezone(zone: string): void {
  if (!DateTime.now().setZone(zone).isValid) {
    throw new Error("Invalid IANA timezone");
  }
}

export function localDate(zone: string, now: DateTime<boolean> = DateTime.utc()): string {
  assertTimezone(zone);
  return now.setZone(zone).toISODate()!;
}

export function nextReminderAt(
  zone: string,
  time: string,
  now: DateTime<boolean> = DateTime.utc(),
): Date {
  assertTimezone(zone);
  const [hour, minute] = time.split(":").map(Number);
  let candidate = now.setZone(zone).set({ hour, minute, second: 0, millisecond: 0 });
  if (candidate <= now.setZone(zone)) candidate = candidate.plus({ days: 1 });
  return candidate.toUTC().toJSDate();
}
