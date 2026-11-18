import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./callables.ts", import.meta.url)), "utf8");

describe("createPhraseLesson reuse", () => {
  it("returns an existing phrase lesson before reserving another daily lesson", () => {
    const start = source.indexOf("export const createPhraseLesson");
    const end = source.indexOf("export const retryFailedLesson");
    const body = source.slice(start, end);
    const reuse = body.indexOf("reusablePhraseLesson");
    const reserve = body.indexOf("reserveLesson");
    expect(reuse).toBeGreaterThan(-1);
    expect(reserve).toBeGreaterThan(reuse);
    expect(body).toContain("return { lessonId: resolvedId, alreadyExists }");
    expect(body).toContain("if (!alreadyExists) await enqueueOrRollBack");
  });
});
