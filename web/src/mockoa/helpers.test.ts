import { describe, expect, it } from "vitest";
import type { ProblemView, SessionView } from "../../../api/src/mockoa/types";
import { clampCount, clampMinutes, clock, prefillFor, stepMinutes } from "./helpers";

describe("the clock", () => {
  it("shows minutes and seconds, hours past an hour, and stops at zero", () => {
    expect(clock(52 * 60_000 + 14_000)).toBe("52:14");
    expect(clock(3_723_000)).toBe("1:02:03");
    expect(clock(400)).toBe("0:01");
    expect(clock(-5000)).toBe("0:00");
  });
});

describe("the steppers", () => {
  it("keeps the count 1–10 and minutes 5–300, stepping minutes by 5 from any typed value", () => {
    expect([clampCount(0), clampCount(4), clampCount(99)]).toEqual([1, 4, 10]);
    expect([clampMinutes(2), clampMinutes(73), clampMinutes(999)]).toEqual([5, 73, 300]);
    expect([stepMinutes(73, 1), stepMinutes(73, -1), stepMinutes(90, 1), stepMinutes(5, -1)]).toEqual([75, 70, 95, 5]);
  });
});

describe("filling in the record form", () => {
  const session = (finishedAt: string) => ({ deadline: "2026-11-03T13:00:00.000Z", finishedAt }) as SessionView;
  const problem = (passed: number, total: number) => ({ best: total ? { passed, total } : null }) as ProblemView;

  it("is Solved at 80% of tests, otherwise Failed", () => {
    expect(prefillFor(session("2026-11-03T12:40:00.000Z"), problem(17, 20))).toEqual({ outcome: "solved", failureMode: null });
    expect(prefillFor(session("2026-11-03T12:40:00.000Z"), problem(15, 20))).toEqual({ outcome: "failed", failureMode: null });
  });

  it("suggests Ran out of time when the clock ended the test", () => {
    expect(prefillFor(session("2026-11-03T13:00:00.000Z"), problem(0, 0))).toEqual({ outcome: "failed", failureMode: "ran-out-of-time" });
  });
});
