import type { FailureMode, Outcome } from "../../../api/src/review/types";

// What Record on the Mock OA results carries to the problem page's normal form (#62).
export interface MockOaPrefill {
  sessionId: string;
  index: number;
  outcome: Outcome;
  minutes: number;
  failureMode: FailureMode | null;
  summary: string; // "Mock OA on Nov 3 · 17 of 20 tests"
}
