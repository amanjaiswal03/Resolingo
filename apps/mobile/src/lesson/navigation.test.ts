import { describe, expect, it } from "vitest";
import { firstRouteParam, lessonExit, percentWidth } from "./navigation";

describe("lessonExit", () => {
  it("pops when the stack has history", () => {
    expect(lessonExit(true)).toBe("back");
  });

  it("replaces home when back would target an empty stack", () => {
    expect(lessonExit(false)).toBe("replace-home");
  });
});

describe("firstRouteParam", () => {
  it("reads a single id and ignores blanks", () => {
    expect(firstRouteParam("lesson-1")).toBe("lesson-1");
    expect(firstRouteParam("")).toBeUndefined();
    expect(firstRouteParam(undefined)).toBeUndefined();
  });

  it("uses the first non-empty id when the param is repeated", () => {
    expect(firstRouteParam(["", "lesson-2"])).toBe("lesson-2");
  });
});

describe("percentWidth", () => {
  it("clamps missing and non-finite progress to an empty bar", () => {
    expect(percentWidth(undefined)).toBe("0%");
    expect(percentWidth(null)).toBe("0%");
    expect(percentWidth(Number.NaN)).toBe("0%");
  });

  it("keeps a finite progress inside 0–100", () => {
    expect(percentWidth(40)).toBe("40%");
    expect(percentWidth(-5)).toBe("0%");
    expect(percentWidth(140)).toBe("100%");
    expect(percentWidth(33.5)).toBe("33.5%");
  });
});
