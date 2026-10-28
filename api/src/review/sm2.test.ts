import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isLocalDate } from "./dates";
import { NEW_STATE, nextReview, qualityFor } from "./sm2";

describe("qualityFor (#47)", () => {
  it("uses your confidence for a confident solve", () => {
    expect(qualityFor("solved", 5)).toBe(5);
    expect(qualityFor("solved", 3)).toBe(3);
  });

  it("treats a shaky solve, a struggle and a failure as lapses", () => {
    expect(qualityFor("solved", 2)).toBe(2);
    expect(qualityFor("solved", 1)).toBe(2);
    expect(qualityFor("struggled", 5)).toBe(2);
    expect(qualityFor("failed", 5)).toBe(1);
  });
});

describe("nextReview", () => {
  it("climbs the ladder 1 → 6 → × ease on passes", () => {
    const first = nextReview(NEW_STATE, 4, "2026-10-28");
    expect(first).toMatchObject({ intervalDays: 1, repetitions: 1, due: "2026-10-29", ease: 2.5 });
    const second = nextReview(first, 4, "2026-10-29");
    expect(second).toMatchObject({ intervalDays: 6, repetitions: 2, due: "2026-11-04" });
    const third = nextReview(second, 4, "2026-11-04");
    expect(third).toMatchObject({ intervalDays: 15, repetitions: 3, due: "2026-11-19" });
  });

  it("restarts at 1 day on a lapse and keeps the ease", () => {
    const state = { ease: 2.2, intervalDays: 15, repetitions: 3 };
    expect(nextReview(state, 2, "2026-12-31")).toEqual({ ease: 2.2, intervalDays: 1, repetitions: 0, due: "2027-01-01" });
  });

  it("raises the ease on a 5, lowers it on a 3, never below 1.3", () => {
    expect(nextReview(NEW_STATE, 5, "2026-10-28").ease).toBeCloseTo(2.6);
    expect(nextReview(NEW_STATE, 3, "2026-10-28").ease).toBeCloseTo(2.36);
    expect(nextReview({ ease: 1.35, intervalDays: 6, repetitions: 2 }, 3, "2026-10-28").ease).toBe(1.3);
  });
});

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-10-28", "2026-11-03")).toBe(6);
    expect(daysBetween("2026-10-28", "2026-10-26")).toBe(-2);
  });

  it("accepts only real YYYY-MM-DD dates", () => {
    expect(isLocalDate("2026-10-28")).toBe(true);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("2026-10-28T00:00")).toBe(false);
    expect(isLocalDate(20261028)).toBe(false);
  });
});
