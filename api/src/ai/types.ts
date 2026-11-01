// Shapes shared by the review Lambda, the API and the web app (#21, #58). No runtime dependencies.

export const PREDICTION_LABELS = ["correct", "partial", "wrong", "none"] as const;

// What Claude must answer with. The text fields are Markdown.
export interface ReviewBody {
  predictionLabel: (typeof PREDICTION_LABELS)[number]; // "none" = you made no prediction
  predictionNote: string;
  optimization: string;
  approach: string;
  conceptualization: string;
  tips: string[];
}

// Stored as PROBLEM#<id> / AIREVIEW#<attempt time>.
export interface AiReview {
  attemptCreatedAt: string;
  status: "done" | "skipped-budget" | "refused" | "failed";
  review?: ReviewBody; // only when done
  costUsd?: number;
  createdAt: string; // ISO time
}

export interface ReviewMessage {
  problemId: string;
  createdAt: string; // the attempt's time, which identifies it
}

export interface BudgetStatus {
  month: string; // YYYY-MM, UTC
  spentUsd: number;
  capUsd: number;
}

export const WARN_AT = 0.8; // banners at 80% and 100% of the cap (#33)

export const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
