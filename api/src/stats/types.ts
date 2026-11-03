// Shapes for /api/stats (#16, #59), shared by the API and the web app. Type-only, no runtime deps.
import type { Difficulty } from "../catalog/types";
import type { FailureMode, Outcome } from "../review/types";

export const RANGES = ["4w", "12w", "all"] as const;
export type Range = (typeof RANGES)[number];

// Only the attempt fields the math needs: never notes or code (#59 C).
export interface StatsAttempt {
  problemId: string;
  createdAt: string;
  localDate: string;
  outcome: Outcome;
  minutes: number;
  failureMode: FailureMode | null;
  difficulty: Difficulty;
  quality: number;
  predicted: boolean; // had a prediction
}

export interface StatsSchedule {
  problemId: string;
  due: string;
  tags: string[];
  attempts: number;
}

export interface PredictionGrade {
  problemId: string;
  attemptCreatedAt: string;
  label: "correct" | "partial" | "wrong";
}

// Topic names and how many catalog problems use each topic.
export interface CatalogSummary {
  names: Record<string, string>;
  counts: Record<string, number>;
}

// One week (4w, 12w) or one month (all). value is null when the bucket has no data.
export interface Bucket {
  start: string; // YYYY-MM-DD: the Monday, or the 1st of the month
  value: number | null;
  n: number; // how many attempts the value is built from
}

// A finished mock OA, as Stats reads it from the MOCKOAS drawer (#63 H).
export interface StatsMockOa {
  createdAt: string;
  minutes: number;
  count: number;
  summary: { passedProblems: number; testsPassed: number; testsTotal: number; usedMinutes: number };
}

export interface StatsResponse {
  range: Range;
  today: string;
  totals: { attempts: number; problems: number }; // all time
  tiles: {
    thisWeek: { attempts: number; reviews: number; fresh: number };
    retention: number | null; // 0–100, in range
    prediction: number | null; // 0–100, in range
    mediumMinutes: number | null; // median, in range
  };
  readiness: { tag: string; name: string; score: number; problems: number }[]; // now, 3+ problems
  recognition: { recognition: ModeCount[]; execution: ModeCount[] }; // in range
  prediction: { buckets: Bucket[]; graded: number; predicted: number };
  time: Record<Difficulty, Bucket[]>; // median minutes of Solved attempts
  retention: { buckets: Bucket[]; rate: number | null; reviews: number };
  failureModes: { mode: FailureMode; buckets: number[]; last: number; prev: number }[];
  gaps: { tag: string; name: string; attempts: number; problems: number }[]; // now
  mockOa: { at: string; score: number; passed: number; count: number; usedMinutes: number; minutes: number }[]; // in range, oldest first
}

export interface ModeCount {
  mode: FailureMode;
  count: number;
}

// "Wrong complexity" counts as execution (#59).
export const RECOGNITION_MODES: FailureMode[] = ["wrong-approach", "misread-constraints"];
export const MIN_READINESS_PROBLEMS = 3;
export const GAP_POOL = 20; // the biggest topics by problem count
export const GAP_COUNT = 4;
