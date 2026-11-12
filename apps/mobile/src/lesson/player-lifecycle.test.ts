import { describe, expect, it } from "vitest";
import { stopOwnedPlayer, type OwnedAudioPlayer } from "./player-lifecycle";

function recordingPlayer(failAt?: "pause" | "clear" | "release"): { player: OwnedAudioPlayer; calls: string[] } {
  const calls: string[] = [];
  const step = (name: "pause" | "clear" | "release", invoke: () => void) => {
    calls.push(name);
    if (failAt === name) throw new Error(`${name} failed`);
    invoke();
  };
  return {
    calls,
    player: {
      pause: () => step("pause", () => undefined),
      clearLockScreenControls: () => step("clear", () => undefined),
      release: () => step("release", () => undefined),
    },
  };
}

describe("stopOwnedPlayer", () => {
  it("removes listeners, pauses, clears the lock screen, then releases", () => {
    const { player, calls } = recordingPlayer();
    const order: string[] = [];
    stopOwnedPlayer(player, () => order.push("listeners"));
    expect(order).toEqual(["listeners"]);
    expect(calls).toEqual(["pause", "clear", "release"]);
    expect(["listeners", ...calls]).toEqual(["listeners", "pause", "clear", "release"]);
  });

  it("still releases when pause or lock-screen cleanup throws", () => {
    const paused = recordingPlayer("pause");
    stopOwnedPlayer(paused.player, () => paused.calls.push("listeners"));
    expect(paused.calls).toEqual(["listeners", "pause", "clear", "release"]);

    const cleared = recordingPlayer("clear");
    stopOwnedPlayer(cleared.player);
    expect(cleared.calls).toEqual(["pause", "clear", "release"]);
  });
});
