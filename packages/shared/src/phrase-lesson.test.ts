import { describe, expect, it } from "vitest";
import { phraseLessonControl, reusablePhraseLesson } from "./phrase-lesson.js";

describe("phrase lesson reuse", () => {
  it("plays a finished lesson, waits while it is created, and retries a failed one", () => {
    expect(phraseLessonControl(null)).toBe("create");
    expect(phraseLessonControl("ready")).toBe("play");
    expect(phraseLessonControl("queued")).toBe("generating");
    expect(phraseLessonControl("generating_content")).toBe("generating");
    expect(phraseLessonControl("synthesizing_audio")).toBe("generating");
    expect(phraseLessonControl("failed")).toBe("retry");
  });

  it("reuses a lesson that is still there and allows another after it is deleted", () => {
    expect(reusablePhraseLesson({ id: "lesson-1", exists: true })).toBe("lesson-1");
    expect(reusablePhraseLesson({ id: "lesson-1", exists: false })).toBeNull();
    expect(reusablePhraseLesson(null)).toBeNull();
  });
});
