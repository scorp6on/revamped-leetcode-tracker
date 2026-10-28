import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "../../../api/src/catalog/types";
import { PAGE_SIZE, emptyQuery, filterCatalog, pageOf } from "./filter";

const p = (id: string, title: string, difficulty: CatalogEntry["difficulty"], ac: number, tags: string[] = []) => ({
  id,
  title,
  slug: title.toLowerCase().replace(/ /g, "-"),
  difficulty,
  ac,
  paid: false,
  tags,
});

const problems: CatalogEntry[] = [
  p("200", "Number of Islands", "Medium", 62.1, ["graph", "bfs"]),
  p("1", "Two Sum", "Easy", 58.1, ["array", "hash-table"]),
  p("76", "Minimum Window Substring", "Hard", 45.3, ["sliding-window"]),
  p("20", "Valid Parentheses", "Easy", 42.0, ["stack"]),
];
const ids = (rows: CatalogEntry[]) => rows.map((r) => r.id);

describe("filterCatalog", () => {
  it("sorts by problem number by default", () => {
    expect(ids(filterCatalog(problems, emptyQuery))).toEqual(["1", "20", "76", "200"]);
  });

  it("searches titles case-insensitively, and numbers exactly (with or without #)", () => {
    expect(ids(filterCatalog(problems, { ...emptyQuery, text: "window" }))).toEqual(["76"]);
    expect(ids(filterCatalog(problems, { ...emptyQuery, text: "20" }))).toEqual(["20"]);
    expect(ids(filterCatalog(problems, { ...emptyQuery, text: "#200" }))).toEqual(["200"]);
  });

  it("filters by difficulty, topic and status together", () => {
    expect(ids(filterCatalog(problems, { ...emptyQuery, difficulties: ["Easy"] }))).toEqual(["1", "20"]);
    expect(ids(filterCatalog(problems, { ...emptyQuery, tag: "graph" }))).toEqual(["200"]);
    const solved = (slug: string) => (slug === "two-sum" ? "solved" : "not-attempted");
    expect(ids(filterCatalog(problems, { ...emptyQuery, status: "solved" }, solved))).toEqual(["1"]);
  });

  it("sorts by difficulty or acceptance, either direction, ties by number", () => {
    expect(ids(filterCatalog(problems, { ...emptyQuery, sort: "difficulty" }))).toEqual(["1", "20", "200", "76"]);
    expect(ids(filterCatalog(problems, { ...emptyQuery, sort: "ac", descending: true }))).toEqual([
      "200",
      "1",
      "76",
      "20",
    ]);
  });
});

describe("pageOf", () => {
  it("returns one page of rows", () => {
    const rows = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => i);
    expect(pageOf(rows, 0)).toHaveLength(PAGE_SIZE);
    expect(pageOf(rows, 1)).toEqual([PAGE_SIZE, PAGE_SIZE + 1, PAGE_SIZE + 2]);
  });
});
