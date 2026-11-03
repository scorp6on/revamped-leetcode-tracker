import { describe, expect, it } from "vitest";
import { bucketsFor, computeStats, mondayOf } from "./compute";
import { makeStatsHandler } from "./route";
import type { StatsStore } from "./store";
import type { CatalogSummary, PredictionGrade, Range, StatsAttempt, StatsSchedule } from "./types";

const TODAY = "2026-11-03"; // a Tuesday

let clock = 0;
const attempt = (problemId: string, localDate: string, over: Partial<StatsAttempt> = {}): StatsAttempt => ({
  problemId,
  localDate,
  createdAt: `${localDate}T12:00:${String(clock++ % 60).padStart(2, "0")}.000Z`,
  outcome: "solved",
  minutes: 20,
  failureMode: null,
  difficulty: "Medium",
  quality: 4,
  predicted: false,
  ...over,
});
const schedule = (problemId: string, tags: string[], over: Partial<StatsSchedule> = {}): StatsSchedule => ({
  problemId,
  tags,
  due: "2026-11-10",
  attempts: 1,
  ...over,
});
const catalog: CatalogSummary = { names: { array: "Array", trie: "Trie" }, counts: { array: 100, trie: 10 } };

const stats = (
  attempts: StatsAttempt[],
  { schedules = [], grades = [], range = "4w" as Range, cat = catalog }: {
    schedules?: StatsSchedule[];
    grades?: PredictionGrade[];
    range?: Range;
    cat?: CatalogSummary;
  } = {},
) => computeStats({ attempts, schedules, grades, catalog: cat, range, today: TODAY });

describe("weeks and months", () => {
  it("starts weeks on Monday", () => {
    expect(mondayOf("2026-11-03")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02"); // Sunday
  });

  it("gives 4 or 12 weekly buckets ending this week", () => {
    expect(bucketsFor("4w", TODAY, undefined).starts).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
    const twelve = bucketsFor("12w", TODAY, undefined).starts;
    expect(twelve).toHaveLength(12);
    expect(twelve[0]).toBe("2026-08-17");
  });

  it("gives monthly buckets from the first attempt for All time", () => {
    expect(bucketsFor("all", TODAY, "2025-12-15").starts).toEqual([
      "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01",
      "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01",
    ]);
    expect(bucketsFor("all", TODAY, undefined).starts).toEqual(["2026-11-01"]);
  });
});

describe("review retention", () => {
  it("counts attempts on an already-attempted problem, retained when Solved", () => {
    const s = stats([
      attempt("1", "2026-10-20"), // first try: not a review
      attempt("1", "2026-10-27", { outcome: "failed", failureMode: "off-by-one" }),
      attempt("1", "2026-11-03"),
      attempt("2", "2026-10-21"),
    ]);
    expect(s.retention.reviews).toBe(2);
    expect(s.retention.rate).toBe(50);
    expect(s.retention.buckets.map((b) => b.value)).toEqual([null, null, 0, 100]);
    expect(s.tiles.retention).toBe(50);
  });

  it("treats a first try before the range as making later ones reviews", () => {
    const s = stats([attempt("1", "2026-01-05"), attempt("1", "2026-11-02", { outcome: "struggled" })]);
    expect(s.retention).toMatchObject({ reviews: 1, rate: 0 });
  });

  it("ignores attempts outside the range", () => {
    const s = stats([attempt("1", "2026-09-01"), attempt("1", "2026-09-08")]);
    expect(s.retention).toMatchObject({ reviews: 0, rate: null });
    expect(s.totals).toEqual({ attempts: 2, problems: 1 });
  });
});

describe("prediction accuracy", () => {
  it("scores Correct 1, Partial ½, Wrong 0 over graded attempts only", () => {
    const a = [
      attempt("1", "2026-11-02", { predicted: true }),
      attempt("2", "2026-11-02", { predicted: true }),
      attempt("3", "2026-11-03", { predicted: true }),
      attempt("4", "2026-11-03", { predicted: true }), // no review yet
    ];
    const grades: PredictionGrade[] = [
      { problemId: "1", attemptCreatedAt: a[0].createdAt, label: "correct" },
      { problemId: "2", attemptCreatedAt: a[1].createdAt, label: "partial" },
      { problemId: "3", attemptCreatedAt: a[2].createdAt, label: "wrong" },
    ];
    const s = stats(a, { grades });
    expect(s.prediction).toMatchObject({ graded: 3, predicted: 4 });
    expect(s.prediction.buckets[3]).toEqual({ start: "2026-11-02", value: 50, n: 3 });
    expect(s.tiles.prediction).toBe(50);
  });
});

describe("time to solve", () => {
  it("takes the median minutes of Solved attempts per difficulty", () => {
    const s = stats([
      attempt("1", "2026-11-02", { minutes: 20 }),
      attempt("2", "2026-11-02", { minutes: 30 }),
      attempt("3", "2026-11-02", { minutes: 40 }),
      attempt("4", "2026-11-02", { minutes: 50 }),
      attempt("5", "2026-11-02", { minutes: 90, outcome: "struggled", failureMode: "off-by-one" }),
      attempt("6", "2026-11-02", { minutes: 9, difficulty: "Easy" }),
    ]);
    expect(s.time.Medium[3]).toEqual({ start: "2026-11-02", value: 35, n: 4 });
    expect(s.time.Easy[3].value).toBe(9);
    expect(s.time.Hard[3]).toEqual({ start: "2026-11-02", value: null, n: 0 });
    expect(s.tiles.mediumMinutes).toBe(35);
  });
});

describe("recognition vs. execution", () => {
  it("puts Wrong approach and Misread constraints in recognition, Wrong complexity in execution", () => {
    const s = stats([
      attempt("1", "2026-11-02", { outcome: "failed", failureMode: "wrong-approach" }),
      attempt("2", "2026-11-02", { outcome: "failed", failureMode: "wrong-approach" }),
      attempt("3", "2026-11-02", { outcome: "struggled", failureMode: "misread-constraints" }),
      attempt("4", "2026-11-02", { outcome: "struggled", failureMode: "wrong-complexity" }),
      attempt("5", "2026-11-02", { outcome: "struggled", failureMode: "off-by-one" }),
    ]);
    expect(s.recognition.recognition).toEqual([
      { mode: "wrong-approach", count: 2 },
      { mode: "misread-constraints", count: 1 },
    ]);
    expect(s.recognition.execution.map((m) => m.mode).sort()).toEqual(["off-by-one", "wrong-complexity"]);
  });
});

describe("failure-mode trend", () => {
  it("counts per bucket and compares the last 4 weeks with the 4 before", () => {
    const s = stats([
      attempt("1", "2026-11-03", { outcome: "failed", failureMode: "off-by-one" }),
      attempt("2", "2026-10-07", { outcome: "failed", failureMode: "off-by-one" }), // 27 days ago: last
      attempt("3", "2026-10-06", { outcome: "failed", failureMode: "off-by-one" }), // 28 days ago: prev
      attempt("4", "2026-09-09", { outcome: "failed", failureMode: "off-by-one" }), // 55 days ago: prev
      attempt("5", "2026-09-08", { outcome: "failed", failureMode: "off-by-one" }), // 56 days ago: neither
    ]);
    expect(s.failureModes).toEqual([{ mode: "off-by-one", buckets: [0, 0, 0, 1], last: 2, prev: 2 }]);
  });
});

describe("pattern readiness", () => {
  it("averages each problem's latest grade out of 5, halved when overdue, for topics with 3+ problems", () => {
    const s = stats(
      [
        attempt("1", "2026-10-01", { quality: 1 }),
        attempt("1", "2026-10-20", { quality: 5 }), // the latest grade counts
        attempt("2", "2026-10-20", { quality: 5 }),
        attempt("3", "2026-10-20", { quality: 4 }),
      ],
      {
        schedules: [
          schedule("1", ["array", "trie"]),
          schedule("2", ["array", "trie"]),
          schedule("3", ["array"], { due: "2026-11-02" }), // overdue: 4/5 × ½
        ],
      },
    );
    expect(s.readiness).toEqual([{ tag: "array", name: "Array", score: 80, problems: 3 }]);
  });
});

describe("coverage gaps", () => {
  it("lists the least-attempted of the biggest topics, bigger first on ties", () => {
    const counts = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`t${i}`, 100 - i]));
    const s = stats([], {
      cat: { names: { t0: "Topic 0" }, counts },
      schedules: [schedule("1", ["t0", "t1"], { attempts: 3 }), schedule("2", ["t2"], { attempts: 1 })],
    });
    // t20–t24 are outside the 20 biggest; t3–t19 have no attempts.
    expect(s.gaps.map((g) => g.tag)).toEqual(["t3", "t4", "t5", "t6"]);
    expect(s.gaps[0]).toEqual({ tag: "t3", name: "t3", attempts: 0, problems: 97 });
    const named = stats([], { cat: { names: { t0: "Topic 0" }, counts: { t0: 5 } }, schedules: [] });
    expect(named.gaps).toEqual([{ tag: "t0", name: "Topic 0", attempts: 0, problems: 5 }]);
  });
});

describe("this week", () => {
  it("counts attempts since Monday, split into reviews and new problems", () => {
    const s = stats([attempt("1", "2026-10-30"), attempt("1", "2026-11-02"), attempt("2", "2026-11-03")]);
    expect(s.tiles.thisWeek).toEqual({ attempts: 2, reviews: 1, fresh: 1 });
  });
});

describe("GET /api/stats", () => {
  const store = {
    attempts: async () => [attempt("1", "2026-11-02")],
    schedules: async () => [],
    grades: async () => [],
    catalog: async () => catalog,
  } as unknown as StatsStore;
  const call = (q: Record<string, string>) =>
    makeStatsHandler(store)({ queryStringParameters: q } as never) as Promise<{ statusCode: number; body: string }>;

  it("needs your local date", async () => {
    expect((await call({ range: "4w" })).statusCode).toBe(400);
    expect((await call({ today: "2026-13-01" })).statusCode).toBe(400);
  });

  it("falls back to 12 weeks for an unknown range", async () => {
    const res = await call({ today: TODAY, range: "1y" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ range: "12w", totals: { attempts: 1 } });
  });
});
