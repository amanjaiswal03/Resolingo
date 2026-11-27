import { describe, expect, it } from "vitest";
import { gateSnapshot } from "./snapshot-gate";

describe("gateSnapshot", () => {
  it("holds a first empty answer from the cache", () => {
    expect(gateSnapshot({ delivered: false, fromCache: true, empty: true, changed: false })).toBe("hold");
  });

  it("shows cached content straight away", () => {
    expect(gateSnapshot({ delivered: false, fromCache: true, empty: false, changed: true })).toBe("deliver");
  });

  it("shows an empty answer once the server confirms it", () => {
    expect(gateSnapshot({ delivered: false, fromCache: false, empty: true, changed: false })).toBe("deliver");
  });

  it("drops later snapshots where only metadata changed", () => {
    expect(gateSnapshot({ delivered: true, fromCache: false, empty: false, changed: false })).toBe("skip");
  });

  it("passes on later document changes, even an emptied list", () => {
    expect(gateSnapshot({ delivered: true, fromCache: true, empty: true, changed: true })).toBe("deliver");
  });
});
