// SM-2 spaced repetition, ported from the old app. Pure: the caller passes the current state and
// your local date, and gets the next state back.
import { addDays } from "./dates";
import type { Outcome, ReviewState } from "./types";

export const NEW_STATE: ReviewState = { ease: 2.5, intervalDays: 0, repetitions: 0 };
const MIN_EASE = 1.3;

// Your grade → SM-2's 0–5 quality (#47). Under 3 is a lapse: the problem comes back tomorrow.
export function qualityFor(outcome: Outcome, confidence: number): number {
  if (outcome === "failed") return 1;
  if (outcome === "struggled") return 2;
  return confidence <= 2 ? 2 : confidence; // a shaky solve counts as a lapse
}

export function nextReview(state: ReviewState, quality: number, today: string): ReviewState & { due: string } {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let { ease, intervalDays, repetitions } = state;

  if (q < 3) {
    // Lapse: start the ladder over. Original SM-2 leaves the ease alone here.
    repetitions = 0;
    intervalDays = 1;
  } else {
    // Pass: 1 day, then 6, then grow by the ease each time.
    intervalDays = repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.round(intervalDays * ease);
    repetitions += 1;
    // 4 leaves the ease unchanged, 5 raises it, 3 lowers it; never below the floor.
    ease = Math.max(MIN_EASE, ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  }

  return { ease, intervalDays, repetitions, due: addDays(today, intervalDays) };
}
