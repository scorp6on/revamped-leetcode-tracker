import { MAX_OA_MINUTES, MIN_OA_MINUTES, PASS_RATIO, type ProblemView, type SessionView } from "../../../api/src/mockoa/types";
import type { FailureMode, Outcome } from "../../../api/src/review/types";

// "52:14", or "1:02:03" past an hour. Never negative.
export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

// The device clock can be off; the server's time when the page loaded corrects it.
export const clockOffset = (serverNow: string, deviceNow: number) => Date.parse(serverNow) - deviceNow;

export const pct = (passed: number, total: number) => (total ? Math.round((passed / total) * 100) : 0);
export const passes = (best: ProblemView["best"]) => !!best && best.total > 0 && best.passed / best.total >= PASS_RATIO;
export const minutesOf = (activeMs: number) => Math.max(1, Math.round(activeMs / 60_000));

// Stepper values (#62): 1–10 problems; any minutes, the buttons move by 5.
export const clampCount = (n: number) => Math.min(10, Math.max(1, Math.round(n) || 1));
export const clampMinutes = (n: number) => Math.min(MAX_OA_MINUTES, Math.max(MIN_OA_MINUTES, Math.round(n) || MIN_OA_MINUTES));
export const stepMinutes = (n: number, dir: 1 | -1) => clampMinutes(dir > 0 ? Math.floor(n / 5) * 5 + 5 : Math.ceil(n / 5) * 5 - 5);

// The normal form, filled in from the test (#62): Solved at 80%+, otherwise Failed. A problem you
// were still on when the clock ran out suggests "Ran out of time"; anything else is yours to pick.
export const prefillFor = (s: SessionView, p: ProblemView): { outcome: Outcome; failureMode: FailureMode | null } => {
  if (passes(p.best)) return { outcome: "solved", failureMode: null };
  const ranOut = !!s.finishedAt && !!s.deadline && Date.parse(s.finishedAt) >= Date.parse(s.deadline);
  return { outcome: "failed", failureMode: ranOut ? "ran-out-of-time" : null };
};

// Your code is kept in this browser on every keystroke (#62 A), so a refresh never loses it.
const KEY = (id: string, i: number) => `mockoa:${id}:${i}`;
export const draftOf = (id: string, i: number): string | null => {
  try {
    return localStorage.getItem(KEY(id, i));
  } catch {
    return null;
  }
};
export const keepDraft = (id: string, i: number, code: string) => {
  try {
    localStorage.setItem(KEY(id, i), code);
  } catch {
    // Storage full or blocked: the server autosave still has it.
  }
};
export const dropDrafts = (id: string, count: number) => {
  try {
    for (let i = 0; i < count; i++) localStorage.removeItem(KEY(id, i));
  } catch {
    // nothing to clean
  }
};

// Your usual time per difficulty for the slow note (#63 H): the median minutes of Solved attempts,
// only once there are 3 or more at that difficulty.
export const MIN_SOLVES_FOR_USUAL = 3;
export const usualMinutes = (attempts: { difficulty: string; outcome: string; minutes: number }[]) => {
  const out: Record<string, number> = {};
  for (const d of ["Easy", "Medium", "Hard"]) {
    const mins = attempts.filter((a) => a.difficulty === d && a.outcome === "solved").map((a) => a.minutes).sort((a, b) => a - b);
    if (mins.length < MIN_SOLVES_FOR_USUAL) continue;
    const mid = Math.floor(mins.length / 2);
    out[d] = mins.length % 2 ? mins[mid] : Math.round((mins[mid - 1] + mins[mid]) / 2);
  }
  return out;
};
