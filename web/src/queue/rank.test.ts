import { describe, expect, it } from "vitest";
import type { RecentFailure, Schedule } from "../../../api/src/review/types";
import { buildQueue, dueLabel, localToday } from "./rank";

const TODAY = "2026-10-28";

const s = (problemId: string, due: string, extra: Partial<Schedule> = {}): Schedule => ({
  problemId,
  slug: `p-${problemId}`,
  title: `Problem ${problemId}`,
  difficulty: "Medium",
  tags: ["array"],
  ease: 2.5,
  intervalDays: 1,
  repetitions: 1,
  due,
  attempts: 1,
  solved: true,
  failureModes: {},
  lastAttemptAt: "2026-10-27T10:00:00.000Z",
  ...extra,
});
const ids = (items: { schedule: Schedule }[]) => items.map((i) => i.schedule.problemId);

describe("buildQueue", () => {
  it("splits into overdue, today and the next 2 days; later ones aren't shown", () => {
    const q = buildQueue(
      [s("1", "2026-10-25"), s("2", "2026-10-27"), s("3", TODAY), s("4", "2026-10-29"), s("5", "2026-10-30"), s("6", "2026-10-31")],
      [],
      TODAY,
    );
    expect(ids(q.overdue)).toEqual(["1", "2"]); // most overdue first
    expect(ids(q.today)).toEqual(["3"]);
    expect(ids(q.upcoming)).toEqual(["4", "5"]);
  });

  it("works with no history: ties go to the lowest ease", () => {
    const q = buildQueue([s("1", TODAY, { ease: 2.5 }), s("2", TODAY, { ease: 1.8 })], [], TODAY);
    expect(ids(q.today)).toEqual(["2", "1"]);
    expect(q.today[0].reason).toEqual(["Due today"]);
  });

  it("leads Today with problems that hit your recent failure modes, and says why", () => {
    const recent: RecentFailure[] = [
      { failureMode: "off-by-one", tags: ["array"] },
      { failureMode: "off-by-one", tags: ["array"] },
      { failureMode: "syntax-error", tags: ["string"] },
    ];
    const q = buildQueue(
      [
        s("1", TODAY),
        s("2", TODAY, { failureModes: { "syntax-error": 1 }, tags: ["string"] }),
        s("3", TODAY, { failureModes: { "off-by-one": 1 }, tags: ["array"] }),
        s("4", TODAY, { failureModes: { "off-by-one": 1 }, tags: ["graph"] }),
      ],
      recent,
      TODAY,
    );
    // 4: off-by-one in a topic where you don't usually make it (failure + transfer), then 3 (failure only).
    expect(ids(q.today)).toEqual(["4", "3", "2", "1"]);
    expect(q.today[0].reason).toEqual([
      "Due today",
      "targets your recent off-by-one errors",
      "same off-by-one pattern, new topic",
    ]);
    expect(q.today[1].reason).toEqual(["Due today", "targets your recent off-by-one errors"]);
  });
});

describe("labels and dates", () => {
  it("describes the due date relative to today", () => {
    expect(dueLabel(TODAY, TODAY)).toBe("Due today");
    expect(dueLabel("2026-10-29", TODAY)).toBe("Due tomorrow");
    expect(dueLabel("2026-10-30", TODAY)).toBe("Due in 2 days");
    expect(dueLabel("2026-10-27", TODAY)).toBe("Due yesterday");
    expect(dueLabel("2026-10-25", TODAY)).toBe("Due 3 days ago");
  });

  it("uses your local calendar date", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
