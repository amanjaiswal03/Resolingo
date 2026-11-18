/** A queued lesson that never accepted a task is abandoned after this long. */
export const STALE_UNENQUEUED_AFTER_MS = 2 * 60 * 1000;

const inProgress = new Set(["queued", "generating_content", "synthesizing_audio"]);

/** Ready and failed lessons can be removed. A lesson still being created cannot. */
export function lessonCanBeDeleted(status: string): boolean {
  return status === "ready" || status === "failed";
}

export function isStaleUnenqueuedLesson(input: {
  status: string | null;
  enqueuePending: boolean;
  updatedAtMs: number | null;
  nowMs: number;
}): boolean {
  if (input.status !== "queued" || !input.enqueuePending) return false;
  if (input.updatedAtMs == null || !Number.isFinite(input.updatedAtMs)) return false;
  return input.nowMs - input.updatedAtMs >= STALE_UNENQUEUED_AFTER_MS;
}

export function activeLessonBlocks(input: {
  status: string | null;
  enqueuePending: boolean;
  updatedAtMs: number | null;
  nowMs: number;
}): boolean {
  if (!input.status || !inProgress.has(input.status)) return false;
  return !isStaleUnenqueuedLesson(input);
}
