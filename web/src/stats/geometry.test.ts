import { describe, expect, it } from "vitest";
import { bucketLabel, changeLabel, linePath, niceMax, points, readinessWord } from "./geometry";

describe("chart geometry", () => {
  it("spreads points across the width with y measured down from the top", () => {
    expect(points([0, 50, 100], 100)).toEqual([
      { x: 0, y: 100 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ]);
    expect(points([5], 10)).toEqual([{ x: 50, y: 50 }]);
  });

  it("lifts the pen over missing weeks", () => {
    expect(linePath([0, null, 100, 100], 100)).toBe("M0 100 M66.67 0 L100 0");
    expect(linePath([null, null], 100)).toBe("");
  });

  it("rounds the axis top up above the largest value", () => {
    expect(niceMax([27, 48, null])).toBe(70);
    expect(niceMax([95])).toBe(150);
    expect(niceMax([null])).toBe(10);
  });

  it("labels readiness and changes", () => {
    expect([70, 69, 40, 39].map(readinessWord)).toEqual(["Ready", "Shaky", "Shaky", "Not ready"]);
    expect(changeLabel(1, 3)).toBe("↓ 3");
    expect(changeLabel(4, 3)).toBe("↑ 3");
    expect(changeLabel(2, 2)).toBe("= 2");
  });

  it("labels weeks by day and months by year", () => {
    expect(bucketLabel("2026-08-17", "12w")).toMatch(/Aug/);
    expect(bucketLabel("2026-08-01", "all")).toMatch(/2026/);
  });
});
