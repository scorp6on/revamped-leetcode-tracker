// Shapes shared by the problem Lambdas and the web app. Type-only imports, so the web bundle stays SDK-free.
import type { Difficulty } from "../catalog/types";

export interface Problem {
  id: string; // LeetCode's frontend number, e.g. "1"
  title: string;
  slug: string;
  difficulty: Difficulty;
  paid: boolean;
  tags: { name: string; slug: string }[];
  content: string | null; // statement HTML; null for Premium problems
}

// Stored as PROBLEM#<id> / PREDICTION#<ISO time> (decision #41). An attempt claims it in M4.
export interface Prediction {
  problemId: string;
  slug: string;
  text: string;
  createdAt: string; // ISO time
  claimed: boolean;
}

export const MAX_PREDICTION_LENGTH = 500;
