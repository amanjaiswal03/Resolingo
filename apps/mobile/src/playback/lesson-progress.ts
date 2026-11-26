/**
 * Where the learner stopped in each lesson, so reopening it picks up there.
 *
 * Positions live on the device first (instant, offline) and in
 * users/{uid}/lessonProgress/{lessonId} so another device resumes too.
 * The newest write wins. Restarting or finishing a lesson writes position 0,
 * so a stale copy on another device can't bring an old position back.
 */
export type LessonProgress = {
  /** Lesson time where playback stopped. */
  positionMs: number;
  /** Lesson length when it was saved, for list progress bars. */
  durationMs: number;
  /** When it was saved, in epoch ms. */
  updatedAt: number;
};

export type ProgressMap = Readonly<Record<string, LessonProgress>>;

/** Below this, the learner barely started: open at the beginning. */
export const MIN_RESUME_MS = 5_000;
/** Within this of the end, the lesson is as good as done: open at the beginning. */
export const END_MARGIN_MS = 15_000;
/** Back up a little so the learner hears the line they were in again. */
export const RESUME_REWIND_MS = 3_000;
/** How often a playing lesson is saved on the device, and to the account. */
export const LOCAL_SAVE_EVERY_MS = 5_000;
export const CLOUD_SAVE_EVERY_MS = 30_000;
/** Keep the stored map small. Oldest entries go first. */
export const PROGRESS_LIMIT = 100;

const MAX_DURATION_MS = 4 * 60 * 60 * 1_000;

/** True when a saved position is worth resuming from. */
export function hasResumablePosition(progress: LessonProgress | undefined, totalMs?: number): progress is LessonProgress {
  if (!progress) return false;
  const total = totalMs && totalMs > 0 ? totalMs : progress.durationMs;
  if (progress.positionMs < MIN_RESUME_MS) return false;
  if (total > 0 && progress.positionMs > total - END_MARGIN_MS) return false;
  return true;
}

/** Where to start playback, or null to start from the beginning. */
export function resumePositionMs(progress: LessonProgress | undefined, totalMs: number): number | null {
  if (!hasResumablePosition(progress, totalMs)) return null;
  return Math.max(0, progress.positionMs - RESUME_REWIND_MS);
}

/** Share of the lesson heard, 0 to 1, or null when there is nothing to show. */
export function progressRatio(progress: LessonProgress | undefined): number | null {
  if (!hasResumablePosition(progress) || progress.durationMs <= 0) return null;
  return Math.min(1, progress.positionMs / progress.durationMs);
}

/** "4 min left", rounded up so a few seconds never read as zero. */
export function remainingLabel(progress: LessonProgress): string {
  const leftMs = Math.max(0, progress.durationMs - progress.positionMs);
  return `${Math.max(1, Math.ceil(leftMs / 60_000))} min left`;
}

function validEntry(value: unknown): LessonProgress | null {
  if (!value || typeof value !== "object") return null;
  const { positionMs, durationMs, updatedAt } = value as Record<string, unknown>;
  if (typeof positionMs !== "number" || typeof durationMs !== "number" || typeof updatedAt !== "number") return null;
  if (![positionMs, durationMs, updatedAt].every(Number.isFinite)) return null;
  if (positionMs < 0 || durationMs < 0 || durationMs > MAX_DURATION_MS) return null;
  return { positionMs: Math.round(positionMs), durationMs: Math.round(durationMs), updatedAt: Math.round(updatedAt) };
}

/** Read stored progress, dropping anything malformed. */
export function parseProgress(raw: string | null | undefined): Record<string, LessonProgress> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, LessonProgress> = {};
    for (const [id, value] of Object.entries(parsed)) {
      const entry = validEntry(value);
      if (entry) out[id] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

/** One Firestore document, or null if it can't be trusted. */
export function progressFromDocument(data: unknown): LessonProgress | null {
  return validEntry(data);
}

/** Keep the newest entries only. */
export function capProgress(map: ProgressMap, limit = PROGRESS_LIMIT): Record<string, LessonProgress> {
  const entries = Object.entries(map);
  if (entries.length <= limit) return { ...map };
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(entries.slice(0, limit));
}

/** Combine two copies. The newer save of each lesson wins. */
export function mergeProgress(base: ProgressMap, incoming: ProgressMap): Record<string, LessonProgress> {
  const out: Record<string, LessonProgress> = { ...base };
  for (const [id, entry] of Object.entries(incoming)) {
    const current = out[id];
    if (!current || entry.updatedAt > current.updatedAt) out[id] = entry;
  }
  return out;
}

/**
 * Whether a new position should go to the account now. Pauses and leaving
 * always sync. While playing, sync at most every CLOUD_SAVE_EVERY_MS.
 */
export function shouldSyncToCloud(reason: "tick" | "pause" | "leave" | "reset", lastCloudAt: number | undefined, now: number): boolean {
  if (reason !== "tick") return true;
  return lastCloudAt == null || now - lastCloudAt >= CLOUD_SAVE_EVERY_MS;
}
