import { describe, expect, it } from "vitest";
import { buildCatalog, toEntry, type LeetCodeQuestion } from "./build";

const q = (over: Partial<LeetCodeQuestion> = {}): LeetCodeQuestion => ({
  frontendQuestionId: "1",
  title: "Two Sum",
  titleSlug: "two-sum",
  difficulty: "Easy",
  acRate: 58.06226325068806,
  paidOnly: false,
  topicTags: [
    { name: "Array", slug: "array" },
    { name: "Hash Table", slug: "hash-table" },
  ],
  ...over,
});

describe("toEntry", () => {
  it("compacts a LeetCode question", () => {
    expect(toEntry(q())).toEqual({
      id: "1",
      title: "Two Sum",
      slug: "two-sum",
      difficulty: "Easy",
      ac: 58.1,
      paid: false,
      tags: ["array", "hash-table"],
    });
  });

  it("keeps the Premium flag", () => {
    expect(toEntry(q({ paidOnly: true })).paid).toBe(true);
  });

  it("rejects a shape it doesn't recognize", () => {
    expect(() => toEntry(q({ difficulty: "Extreme" }))).toThrow(/unexpected/);
    expect(() => toEntry(q({ titleSlug: "" }))).toThrow(/unexpected/);
  });
});

describe("buildCatalog", () => {
  it("collects tag names once and stamps the time", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const catalog = buildCatalog(
      [q(), q({ frontendQuestionId: "2", titleSlug: "add-two-numbers", topicTags: [{ name: "Math", slug: "math" }] })],
      2,
      now,
    );
    expect(catalog.generatedAt).toBe("2026-10-28T12:00:00.000Z");
    expect(catalog.tags).toEqual({ array: "Array", "hash-table": "Hash Table", math: "Math" });
    expect(catalog.problems).toHaveLength(2);
  });

  it("refuses to replace the catalog when most problems are missing", () => {
    expect(() => buildCatalog([q()], 4096)).toThrow(/keeping the existing catalog/);
    expect(() => buildCatalog([], 0)).toThrow();
  });
});
