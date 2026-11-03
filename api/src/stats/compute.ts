// All the Stats math (#16, #59) as one pure function: data in, numbers out, no AWS.
import type { Difficulty } from "../catalog/types";
import { addDays } from "../review/dates";
import type { FailureMode } from "../review/types";
import {
  GAP_COUNT,
  GAP_POOL,
  MIN_READINESS_PROBLEMS,
  RECOGNITION_MODES,
  type Bucket,
  type CatalogSummary,
  type ModeCount,
  type PredictionGrade,
  type Range,
  type StatsAttempt,
  type StatsResponse,
  type StatsSchedule,
} from "./types";

const WEEKS: Record<Exclude<Range, "all">, number> = { "4w": 4, "12w": 12 };
const PREDICTION_SCORE = { correct: 1, partial: 0.5, wrong: 0 } as const;

// Weeks start on Monday (#59 B).
export const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

const nextMonth = (start: string) => {
  const [y, m] = start.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

// The bucket start dates for a range, oldest first, and which bucket a date falls in.
export function bucketsFor(range: Range, today: string, firstDate: string | undefined) {
  if (range === "all") {
    const starts = [monthOf(firstDate && firstDate < today ? firstDate : today)];
    while (starts[starts.length - 1] < monthOf(today)) starts.push(nextMonth(starts[starts.length - 1]));
    return { starts, of: monthOf };
  }
  const last = mondayOf(today);
  const starts = Array.from({ length: WEEKS[range] }, (_, i) => addDays(last, -7 * (WEEKS[range] - 1 - i)));
  return { starts, of: mondayOf };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
};
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : null);

export function computeStats(input: {
  attempts: StatsAttempt[];
  schedules: StatsSchedule[];
  grades: PredictionGrade[];
  catalog: CatalogSummary;
  range: Range;
  today: string;
}): StatsResponse {
  const { schedules, catalog, range, today } = input;
  const attempts = [...input.attempts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const name = (tag: string) => catalog.names[tag] ?? tag;

  // A review is any attempt on a problem you'd attempted before (#59 G).
  const seen = new Set<string>();
  const isReview = new Map<StatsAttempt, boolean>();
  for (const a of attempts) {
    isReview.set(a, seen.has(a.problemId));
    seen.add(a.problemId);
  }

  const { starts, of } = bucketsFor(range, today, attempts[0]?.localDate);
  const inRange = attempts.filter((a) => a.localDate >= starts[0] && a.localDate <= today);
  // Attempts grouped by bucket, in the same order as starts.
  const byBucket = starts.map((s) => inRange.filter((a) => of(a.localDate) === s));
  const series = (value: (group: StatsAttempt[]) => { value: number | null; n: number }): Bucket[] =>
    byBucket.map((group, i) => ({ start: starts[i], ...value(group) }));

  // Retention: reviews that came out Solved.
  const retentionOf = (group: StatsAttempt[]) => {
    const reviews = group.filter((a) => isReview.get(a));
    return { value: percent(reviews.filter((a) => a.outcome === "solved").length, reviews.length), n: reviews.length };
  };
  const retention = retentionOf(inRange);

  // Prediction accuracy: Correct 1, Partial ½, Wrong 0, from the AI review.
  const grade = new Map(input.grades.map((g) => [`${g.problemId}|${g.attemptCreatedAt}`, g.label]));
  const predictionOf = (group: StatsAttempt[]) => {
    const labels = group.flatMap((a) => grade.get(`${a.problemId}|${a.createdAt}`) ?? []);
    const score = labels.reduce((sum, l) => sum + PREDICTION_SCORE[l], 0);
    return { value: labels.length ? Math.round((score / labels.length) * 100) : null, n: labels.length };
  };
  const prediction = predictionOf(inRange);

  // Time to solve: median minutes of Solved attempts, per difficulty.
  const minutesOf = (difficulty: Difficulty) => (group: StatsAttempt[]) => {
    const mins = group.filter((a) => a.outcome === "solved" && a.difficulty === difficulty).map((a) => a.minutes);
    return { value: median(mins), n: mins.length };
  };

  // Recognition vs. execution, from the failure mode picked.
  const counts = new Map<FailureMode, number>();
  for (const a of inRange) if (a.failureMode) counts.set(a.failureMode, (counts.get(a.failureMode) ?? 0) + 1);
  const modeCounts = [...counts].map(([mode, count]): ModeCount => ({ mode, count })).sort((a, b) => b.count - a.count);

  // Failure-mode trend: per-bucket counts, plus the last 4 weeks against the 4 before.
  const lastFrom = addDays(today, -27);
  const prevFrom = addDays(today, -55);
  const failureModes = [...new Set(attempts.flatMap((a) => (a.failureMode ? [a.failureMode] : [])))]
    .map((mode) => ({
      mode,
      buckets: byBucket.map((g) => g.filter((a) => a.failureMode === mode).length),
      last: attempts.filter((a) => a.failureMode === mode && a.localDate >= lastFrom && a.localDate <= today).length,
      prev: attempts.filter((a) => a.failureMode === mode && a.localDate >= prevFrom && a.localDate < lastFrom).length,
    }))
    .filter((m) => m.last + m.prev + m.buckets.reduce((s, c) => s + c, 0) > 0)
    .sort((a, b) => b.buckets.reduce((s, c) => s + c, 0) - a.buckets.reduce((s, c) => s + c, 0));

  // Readiness (#59): each problem scores its latest grade out of 5, halved when its review is overdue.
  const latest = new Map<string, number>();
  for (const a of attempts) latest.set(a.problemId, a.quality); // sorted oldest first, so the last one wins
  const byTag = new Map<string, number[]>();
  for (const s of schedules) {
    const score = ((latest.get(s.problemId) ?? 0) / 5) * (s.due < today ? 0.5 : 1);
    for (const tag of s.tags) byTag.set(tag, [...(byTag.get(tag) ?? []), score]);
  }
  const readiness = [...byTag]
    .filter(([, scores]) => scores.length >= MIN_READINESS_PROBLEMS)
    .map(([tag, scores]) => ({
      tag,
      name: name(tag),
      score: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100),
      problems: scores.length,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // Coverage gaps: the least-attempted of the biggest topics.
  const gaps = Object.entries(catalog.counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, GAP_POOL)
    .map(([tag, problems]) => ({
      tag,
      name: name(tag),
      problems,
      attempts: schedules.filter((s) => s.tags.includes(tag)).reduce((sum, s) => sum + s.attempts, 0),
    }))
    .sort((a, b) => a.attempts - b.attempts || b.problems - a.problems)
    .slice(0, GAP_COUNT);

  const thisWeek = attempts.filter((a) => a.localDate >= mondayOf(today) && a.localDate <= today);
  const reviewsThisWeek = thisWeek.filter((a) => isReview.get(a)).length;

  return {
    range,
    today,
    totals: { attempts: attempts.length, problems: seen.size },
    tiles: {
      thisWeek: { attempts: thisWeek.length, reviews: reviewsThisWeek, fresh: thisWeek.length - reviewsThisWeek },
      retention: retention.value,
      prediction: prediction.value,
      mediumMinutes: minutesOf("Medium")(inRange).value,
    },
    readiness,
    recognition: {
      recognition: modeCounts.filter((m) => RECOGNITION_MODES.includes(m.mode)),
      execution: modeCounts.filter((m) => !RECOGNITION_MODES.includes(m.mode)),
    },
    prediction: {
      buckets: series(predictionOf),
      graded: prediction.n,
      predicted: inRange.filter((a) => a.predicted).length,
    },
    time: { Easy: series(minutesOf("Easy")), Medium: series(minutesOf("Medium")), Hard: series(minutesOf("Hard")) },
    retention: { buckets: series(retentionOf), rate: retention.value, reviews: retention.n },
    failureModes,
    gaps,
  };
}
