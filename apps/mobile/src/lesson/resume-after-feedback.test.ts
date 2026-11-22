import { describe, expect, it } from "vitest";
import { resumeAfterFeedback } from "./resume-after-feedback";

const pause = { currentSeconds: 4.2, pauseEndSeconds: 8.4 };

describe("resume after spoken feedback", () => {
  it("jumps to the end of the pause after a correct, close, missed, or silent answer", () => {
    expect(resumeAfterFeedback({ ...pause, outcome: "recalled" })).toBe(8.4);
    expect(resumeAfterFeedback({ ...pause, outcome: "compare" })).toBe(8.4);
    expect(resumeAfterFeedback({ ...pause, outcome: "unclear" })).toBe(8.4);
    expect(resumeAfterFeedback({ ...pause, outcome: "skipped" })).toBe(8.4);
  });

  it("keeps waiting while the answer window is still open", () => {
    expect(resumeAfterFeedback({ ...pause, outcome: null })).toBe(4.2);
    expect(resumeAfterFeedback({ outcome: "recalled", currentSeconds: 9, pauseEndSeconds: 8.4 })).toBe(9);
  });
});
