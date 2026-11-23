import { describe, expect, it } from "vitest";
import { notePlaybackPaused, SESSION_RELEASE_MS, settleDelayMs } from "./audio-session-settle";

describe("audio session settle", () => {
  it("waits out the session release after a pause, and not at all otherwise", () => {
    notePlaybackPaused(10_000);
    expect(settleDelayMs(10_000)).toBe(SESSION_RELEASE_MS);
    expect(settleDelayMs(10_100)).toBe(SESSION_RELEASE_MS - 100);
    expect(settleDelayMs(10_000 + SESSION_RELEASE_MS + 1)).toBe(0);
  });

  it("covers iOS releasing the session about 100 ms after a pause", () => {
    expect(SESSION_RELEASE_MS).toBeGreaterThan(100);
  });
});
