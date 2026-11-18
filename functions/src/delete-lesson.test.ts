import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lessonCanBeDeleted } from "@resolingo/shared";

const source = readFileSync(fileURLToPath(new URL("./callables.ts", import.meta.url)), "utf8");

function deleteLessonSource(): string {
  const start = source.indexOf("export const deleteLesson");
  const end = source.indexOf("export const registerPushDevice");
  return source.slice(start, end);
}

describe("deleteLesson", () => {
  it("refuses an in-progress lesson and allows a finished one", () => {
    expect(lessonCanBeDeleted("synthesizing_audio")).toBe(false);
    expect(lessonCanBeDeleted("ready")).toBe(true);
  });

  it("deletes the lesson document and its audio without refunding the day or the review history", () => {
    const body = deleteLessonSource();
    expect(body).toContain("lessonCanBeDeleted");
    expect(body).toContain("users/${uid}/lessons/${lessonId}/");
    expect(body).toContain("lessonRef.delete()");
    expect(body).not.toContain("readyCount");
    expect(body).not.toContain("reviewItems");
    expect(body).not.toContain("recursiveDelete");
  });
});
