// Shapes shared by the API and the web app. Type-only imports, so the web bundle stays SDK-free.
import type { Difficulty } from "../catalog/types";

export const OUTCOMES = ["solved", "struggled", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

// The old seven plus "knew the approach, couldn't implement it" (decision #18).
export const FAILURE_MODES = {
  "off-by-one": "Off-by-one",
  "missed-edge-case": "Missed edge case",
  "wrong-complexity": "Wrong complexity",
  "misread-constraints": "Misread constraints",
  "wrong-approach": "Wrong approach",
  "syntax-error": "Syntax error",
  "ran-out-of-time": "Ran out of time",
  "couldnt-implement": "Knew the approach, couldn't implement it",
} as const;
export type FailureMode = keyof typeof FAILURE_MODES;

export const MAX_MINUTES = 600;
export const MAX_NOTES_LENGTH = 5000; // per note section (#53)

// The three optional note sections (#51), in Markdown. Images are /img/<uuid>.jpg links (#52).
export const NOTE_SECTIONS = {
  approach: "Approach",
  learned: "What I learned",
  reflection: "Reflection",
} as const;
export type NoteSection = keyof typeof NOTE_SECTIONS;

// What you fill in when recording (#19), plus the problem facts the page already has.
export interface AttemptInput {
  problemId: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  tags: string[]; // topic slugs
  outcome: Outcome;
  confidence: number; // 1–5
  minutes: number;
  failureMode: FailureMode | null; // required for struggled / failed (#50)
  approach: string;
  learned: string;
  reflection: string;
  localDate: string; // your YYYY-MM-DD when you recorded it (#50)
}

// Stored as PROBLEM#<id> / ATTEMPT#<ISO time>; also in the ATTEMPTS drawer of GSI1.
export interface Attempt extends AttemptInput {
  createdAt: string; // ISO time
  quality: number; // the 0–5 SM-2 grade it produced
  prediction: string | null; // the claimed prediction's text, if any
  notes?: string; // the single note box of attempts recorded before M4.5 (#53)
}

export interface ReviewState {
  ease: number;
  intervalDays: number;
  repetitions: number;
}

// Stored as PROBLEM#<id> / SCHEDULE; also in the DUE drawer of GSI1. Carries the problem facts
// the queue ranking and catalog need, so neither has to read attempts (#50).
export interface Schedule extends ReviewState {
  problemId: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  due: string; // YYYY-MM-DD in your local day
  attempts: number;
  solved: boolean; // ever solved
  failureModes: Partial<Record<FailureMode, number>>; // counts on this problem
  lastAttemptAt: string; // ISO time
}

// One entry per recent attempt that had a failure mode, newest first. Feeds the Today ranking.
export interface RecentFailure {
  failureMode: FailureMode;
  tags: string[];
}

export interface ScheduleResponse {
  schedules: Schedule[];
  recentFailures: RecentFailure[];
}
