import { describe, expect, it } from "vitest";
import { lessonCanBeDeleted } from "./active-lesson.js";

describe("lesson deletion", () => {
  it("allows a finished or failed lesson", () => {
    expect(lessonCanBeDeleted("ready")).toBe(true);
    expect(lessonCanBeDeleted("failed")).toBe(true);
  });

  it("refuses a lesson that is still being created", () => {
    expect(lessonCanBeDeleted("queued")).toBe(false);
    expect(lessonCanBeDeleted("generating_content")).toBe(false);
    expect(lessonCanBeDeleted("synthesizing_audio")).toBe(false);
    expect(lessonCanBeDeleted("")).toBe(false);
  });
});
