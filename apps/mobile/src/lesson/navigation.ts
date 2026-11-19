/** Leave a lesson on the home tabs. A phrase screen may still be underneath, so back is not a pop. */
export function lessonExit(canGoBack: boolean): "home" | "replace-home" {
  return canGoBack ? "home" : "replace-home";
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
