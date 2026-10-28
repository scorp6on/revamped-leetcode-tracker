// The review queue: split by due date (#8), Today ranked by your recent failure modes (#48).
// Ported from the old app's recommender, minus its "how overdue" part: Overdue has its own
// section, so every problem in Today is equally due.
import { addDays, daysBetween } from "../../../api/src/review/dates";
import type { FailureMode, RecentFailure, Schedule } from "../../../api/src/review/types";

export const UPCOMING_DAYS = 2;
const WEIGHTS = { failure: 0.3, transfer: 0.2 };

const LABEL: Record<FailureMode, string> = {
  "off-by-one": "off-by-one",
  "missed-edge-case": "edge-case",
  "wrong-complexity": "complexity",
  "misread-constraints": "constraint-reading",
  "wrong-approach": "wrong-approach",
  "syntax-error": "syntax",
  "ran-out-of-time": "time-pressure",
  "couldnt-implement": "implementation",
};

export interface QueueItem {
  schedule: Schedule;
  reason: string[]; // fragments joined with " · " for display
}

export interface Queue {
  today: QueueItem[];
  upcoming: QueueItem[];
  overdue: QueueItem[];
}

// Your local calendar date as YYYY-MM-DD.
export const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export function dueLabel(due: string, today: string): string {
  const days = daysBetween(today, due);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days === -1) return "Due yesterday";
  return days > 0 ? `Due in ${days} days` : `Due ${-days} days ago`;
}

// Recent failure modes weighted by recency (newest counts most), scaled so the top mode is 1.
function failureProfile(recent: RecentFailure[]): Map<FailureMode, number> {
  const raw = new Map<FailureMode, number>();
  recent.forEach((f, i) => raw.set(f.failureMode, (raw.get(f.failureMode) ?? 0) + 0.85 ** i));
  const max = Math.max(0, ...raw.values());
  return new Map([...raw].map(([mode, v]) => [mode, v / max]));
}

// For each failure mode, the topics where you hit it most often.
function homeTopics(recent: RecentFailure[]): Map<FailureMode, Set<string>> {
  const counts = new Map<FailureMode, Map<string, number>>();
  for (const f of recent) {
    const byTopic = counts.get(f.failureMode) ?? new Map<string, number>();
    for (const t of f.tags) byTopic.set(t, (byTopic.get(t) ?? 0) + 1);
    counts.set(f.failureMode, byTopic);
  }
  return new Map(
    [...counts].map(([mode, byTopic]) => {
      const top = Math.max(0, ...byTopic.values());
      return [mode, new Set([...byTopic].filter(([, n]) => n === top).map(([t]) => t))];
    }),
  );
}

function score(s: Schedule, profile: Map<FailureMode, number>, home: Map<FailureMode, Set<string>>) {
  // Failure modes you've hit on this problem that also matter to you lately.
  const relevant = (Object.keys(s.failureModes) as FailureMode[]).filter((m) => (profile.get(m) ?? 0) > 0);
  const failure = Math.max(0, ...relevant.map((m) => profile.get(m) ?? 0));
  // Of those, the share that would be tested outside the topics where you usually hit them.
  const transfer = relevant.length
    ? relevant.filter((m) => !s.tags.some((t) => home.get(m)?.has(t))).length / relevant.length
    : 0;
  const top = relevant.sort((a, b) => (profile.get(b) ?? 0) - (profile.get(a) ?? 0))[0];
  const reason: string[] = [];
  if (top && failure >= 0.34) reason.push(`targets your recent ${LABEL[top]} errors`);
  if (top && transfer >= 0.5) reason.push(`same ${LABEL[top]} pattern, new topic`);
  return { value: WEIGHTS.failure * failure + WEIGHTS.transfer * transfer, reason };
}

const byDueThenId = (a: Schedule, b: Schedule) => a.due.localeCompare(b.due) || Number(a.problemId) - Number(b.problemId);

export function buildQueue(schedules: Schedule[], recent: RecentFailure[], today: string): Queue {
  const profile = failureProfile(recent);
  const home = homeTopics(recent);
  const lastUpcoming = addDays(today, UPCOMING_DAYS);
  const item = (s: Schedule, extra: string[] = []): QueueItem => ({ schedule: s, reason: [dueLabel(s.due, today), ...extra] });

  const todays = schedules
    .filter((s) => s.due === today)
    .map((s) => ({ s, ...score(s, profile, home) }))
    // Highest score first; ties go to the problem that's been hardest for you (lowest ease).
    .sort((a, b) => b.value - a.value || a.s.ease - b.s.ease || Number(a.s.problemId) - Number(b.s.problemId));

  return {
    today: todays.map(({ s, reason }) => item(s, reason)),
    upcoming: schedules.filter((s) => s.due > today && s.due <= lastUpcoming).sort(byDueThenId).map((s) => item(s)),
    overdue: schedules.filter((s) => s.due < today).sort(byDueThenId).map((s) => item(s)), // most overdue first
  };
}
