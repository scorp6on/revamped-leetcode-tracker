import { describe, expect, it } from "vitest";
import { fromGraphql, fromRest, judged, newerThan } from "./leetcode";

const row = (id: string) => fromGraphql({
  id, title: "Two Sum", titleSlug: "two-sum", statusDisplay: "Accepted", lang: "python3", runtime: "52 ms", memory: "17 MB", timestamp: "1793390000",
});

describe("reading LeetCode's answers", () => {
  it("turns a history row into a submission, with code", () => {
    expect(
      fromRest({
        id: 1500000123, title: "Two Sum", title_slug: "two-sum", status_display: "Wrong Answer",
        lang: "python3", runtime: "N/A", memory: "", timestamp: 1793390000, code: "class Solution: ...",
      }),
    ).toEqual({
      id: "1500000123", slug: "two-sum", title: "Two Sum", status: "Wrong Answer", accepted: false,
      lang: "python3", runtime: "N/A", memory: null, timestamp: 1793390000, code: "class Solution: ...",
    });
  });

  it("leaves rows LeetCode is still judging for the next sync", () => {
    const base = {
      title: "Two Sum", title_slug: "two-sum", status_display: "Accepted", lang: "python3",
      runtime: "52 ms", memory: "17 MB", timestamp: 1793390000, code: "",
    };
    const rows = [{ ...base, id: 2, is_pending: "Pending" }, { ...base, id: 1, is_pending: "Not Pending" }];
    expect(judged(rows).map((r) => r.id)).toEqual([1]);
  });

  it("turns a GraphQL row into a submission, without code", () => {
    expect(row("42")).toMatchObject({ id: "42", accepted: true, timestamp: 1793390000, code: null });
  });
});

describe("newerThan", () => {
  const page = ["105", "104", "103", "102"].map(row); // newest first

  it("keeps only what's newer than the last one sent, and stops there", () => {
    expect(newerThan(page, "103")).toMatchObject({ done: true });
    expect(newerThan(page, "103").fresh.map((r) => r.id)).toEqual(["105", "104"]);
  });

  it("asks for the next page when the last one sent isn't on this one", () => {
    const r = newerThan(page, "99");
    expect(r.done).toBe(false);
    expect(r.fresh).toHaveLength(4);
  });

  it("takes just the latest page on the very first sync", () => {
    expect(newerThan(page, null)).toEqual({ fresh: page, done: true });
  });

  it("compares IDs as numbers, not text", () => {
    expect(newerThan([row("1000"), row("999")], "999").fresh.map((r) => r.id)).toEqual(["1000"]);
  });
});
