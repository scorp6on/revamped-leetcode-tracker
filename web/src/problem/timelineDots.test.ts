import { describe, expect, it } from "vitest";
import { timelineDots } from "./timelineDots";

const attempts = [
  { localDate: "2026-11-03", outcome: "solved" as const },
  { localDate: "2026-10-30", outcome: "struggled" as const },
  { localDate: "2026-10-09", outcome: "struggled" as const },
  { localDate: "2026-10-01", outcome: "failed" as const },
];

describe("timeline dots", () => {
  it("spaces attempts by date, oldest first, ending at the next review", () => {
    const dots = timelineDots(attempts, "2026-11-18", 8);
    expect(dots.map((d) => [d.date, d.kind, Math.round(d.x), d.gap])).toEqual([
      ["2026-10-01", "failed", 0, "first try"],
      ["2026-10-09", "struggled", 17, "+8 d"],
      ["2026-10-30", "struggled", 60, "+21 d"],
      ["2026-11-03", "solved", 69, "+4 d"],
      ["2026-11-18", "next", 100, "+15 d"],
    ]);
    expect(dots.every((d) => d.labelled)).toBe(true);
  });

  it("drops the labels of an older dot that would collide with a newer one", () => {
    const dots = timelineDots(attempts, "2026-11-18", 15);
    expect(dots.map((d) => d.labelled)).toEqual([true, true, false, true, true]);
  });

  it("centres a single attempt with no review date, and handles none at all", () => {
    expect(timelineDots([attempts[0]], null, 10)).toEqual([
      { date: "2026-11-03", kind: "solved", x: 50, gap: "first try", labelled: true },
    ]);
    expect(timelineDots([], null, 10)).toEqual([]);
  });

  it("spreads attempts evenly when they're all on one day", () => {
    const same = [
      { localDate: "2026-11-03", outcome: "failed" as const },
      { localDate: "2026-11-03", outcome: "solved" as const },
    ];
    expect(timelineDots(same, "2026-11-03", 10).map((d) => d.x)).toEqual([0, 50, 100]);
  });
});
