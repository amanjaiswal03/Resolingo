/** Pop the lesson when the stack has history; otherwise land on the home tabs. */
export function lessonExit(canGoBack: boolean): "back" | "replace-home" {
  return canGoBack ? "back" : "replace-home";
}

/** `useLocalSearchParams` may hand back a string, a list, or nothing while a screen is popping. */
export function firstRouteParam(value: string | string[] | undefined): string | undefined {
  const entries = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return entries.find((entry) => entry.length > 0);
}

/** Yoga throws on non-finite percentage widths, including `undefined%` from a missing progress field. */
export function percentWidth(value: number | null | undefined): `${number}%` {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0%";
  return `${Math.min(100, Math.max(0, value))}%` as `${number}%`;
}
