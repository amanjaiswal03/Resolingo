import { describe, expect, it } from "vitest";
import { HOW_WOULD_YOU_SAY_ENABLED, showHowWouldYouSayLesson } from "./features";

describe("How would you say", () => {
  it("stays off and keeps conversation and grammar lessons visible", () => {
    expect(HOW_WOULD_YOU_SAY_ENABLED).toBe(false);
    expect(showHowWouldYouSayLesson("phrase")).toBe(false);
    expect(showHowWouldYouSayLesson("conversation")).toBe(true);
    expect(showHowWouldYouSayLesson("grammar")).toBe(true);
  });
});
