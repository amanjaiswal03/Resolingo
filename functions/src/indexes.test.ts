import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Index = {
  collectionGroup: string;
  queryScope: string;
  fields: { fieldPath: string }[];
};

const indexes = JSON.parse(readFileSync(fileURLToPath(new URL("../../firestore.indexes.json", import.meta.url)), "utf8")) as { indexes: Index[] };

function hasIndex(collectionGroup: string, queryScope: string, fields: string[]): boolean {
  return indexes.indexes.some((index) =>
    index.collectionGroup === collectionGroup
    && index.queryScope === queryScope
    && index.fields.map((field) => field.fieldPath).join(",") === fields.join(","));
}

describe("firestore indexes", () => {
  it("covers the reminder completion lookup", () => {
    expect(hasIndex("lessons", "COLLECTION", ["quotaDate", "completed"])).toBe(true);
  });

  it("covers the unenqueued-lesson sweep", () => {
    expect(hasIndex("lessons", "COLLECTION_GROUP", ["enqueuePending", "updatedAt"])).toBe(true);
  });
});
