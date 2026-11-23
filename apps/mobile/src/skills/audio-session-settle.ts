/**
 * On iOS, pausing a player releases the shared audio session about 100 ms later.
 * A recording that starts inside that window gets its session switched off and
 * records silence. Recording waits until the window has passed.
 */
export const SESSION_RELEASE_MS = 250;

let pausedAt = 0;

export function notePlaybackPaused(now = Date.now()): void {
  pausedAt = now;
}

/** How long to wait before recording so a recent pause can't cut the microphone off. */
export function settleDelayMs(now = Date.now()): number {
  return Math.max(0, pausedAt + SESSION_RELEASE_MS - now);
}

export async function waitForSessionSettle(): Promise<void> {
  const delay = settleDelayMs();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
