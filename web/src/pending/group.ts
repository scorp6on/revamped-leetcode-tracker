import { MAX_MINUTES } from "../../../api/src/review/types";
import type { Submission } from "../../../api/src/sync/types";

// Everything waiting on one problem is one grade (#57).
export interface PendingGroup {
  slug: string;
  title: string;
  submissions: Submission[]; // oldest first
}

// Most recently submitted problem first.
export function groupPending(subs: Submission[]): PendingGroup[] {
  const groups = new Map<string, PendingGroup>();
  for (const s of [...subs].sort((a, b) => a.timestamp - b.timestamp)) {
    const g = groups.get(s.slug) ?? { slug: s.slug, title: s.title, submissions: [] };
    g.submissions.push(s);
    groups.set(s.slug, g);
  }
  const last = (g: PendingGroup) => g.submissions[g.submissions.length - 1].timestamp;
  return [...groups.values()].sort((a, b) => last(b) - last(a));
}

// Prediction to last submission, as a starting point you can edit (#57). No usable prediction, no guess.
export function prefillMinutes(predictionAt: string | null, subs: Submission[]): number | null {
  if (!predictionAt || !subs.length) return null;
  const start = Date.parse(predictionAt);
  if (start > subs[0].timestamp * 1000) return null;
  const minutes = Math.round((subs[subs.length - 1].timestamp * 1000 - start) / 60_000);
  return Math.min(MAX_MINUTES, Math.max(1, minutes));
}

export const countLabel = (n: number) => `${n} submission${n === 1 ? "" : "s"}`;
