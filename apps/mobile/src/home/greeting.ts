/** A short greeting for the Today header, from the hour in the learner's time zone. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

export function hourInZone(zone: string, now = new Date()): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(now);
    return Number.parseInt(hour, 10) % 24;
  } catch {
    return now.getHours();
  }
}
