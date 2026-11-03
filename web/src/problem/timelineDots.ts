import { daysBetween } from "../../../api/src/review/dates";
import type { Outcome } from "../../../api/src/review/types";

// The per-problem timeline (#60): one dot per attempt, spaced by date, then the next review.

export interface TimelineDot {
  date: string;
  kind: Outcome | "next";
  x: number; // 0–100 across the track
  gap: string; // "first try" or "+8 d" since the dot before
  labelled: boolean; // false when it would collide with a newer dot's labels
}

export function timelineDots(
  attempts: { localDate: string; outcome: Outcome }[], // any order
  due: string | null,
  minGap: number, // the closest two labelled dots may be, in % of the track
): TimelineDot[] {
  const points = [...attempts]
    .sort((a, b) => a.localDate.localeCompare(b.localDate))
    .map((a) => ({ date: a.localDate, kind: a.outcome as TimelineDot["kind"] }));
  if (due && (!points.length || due >= points[points.length - 1].date)) points.push({ date: due, kind: "next" });
  if (!points.length) return [];

  const first = points[0].date;
  const span = daysBetween(first, points[points.length - 1].date);
  const dots = points.map((p, i) => ({
    ...p,
    x: span ? (daysBetween(first, p.date) / span) * 100 : points.length === 1 ? 50 : (i / (points.length - 1)) * 100,
    gap: i ? `+${daysBetween(points[i - 1].date, p.date)} d` : "first try",
    labelled: true,
  }));
  // Newest first, so the latest attempt and the next review always keep their labels.
  let lastX = Infinity;
  for (let i = dots.length - 1; i >= 0; i--) {
    dots[i].labelled = lastX - dots[i].x >= minGap;
    if (dots[i].labelled) lastX = dots[i].x;
  }
  return dots;
}
