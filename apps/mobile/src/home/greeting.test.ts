import { describe, expect, it } from "vitest";
import { greetingFor, hourInZone } from "./greeting";

describe("greetingFor", () => {
  it("follows the time of day", () => {
    expect(greetingFor(6)).toBe("Good morning");
    expect(greetingFor(13)).toBe("Good afternoon");
    expect(greetingFor(22)).toBe("Good evening");
    expect(greetingFor(2)).toBe("Good evening");
  });
});

describe("hourInZone", () => {
  it("reads the hour in the given zone", () => {
    expect(hourInZone("Europe/Berlin", new Date("2026-11-26T21:30:00Z"))).toBe(22);
    expect(hourInZone("UTC", new Date("2026-11-26T00:10:00Z"))).toBe(0);
  });
});
