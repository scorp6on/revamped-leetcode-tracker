import { addDays, daysBetween } from "../../../api/src/review/dates";
import type { HistoryAttempt } from "../../../api/src/review/types";

// Streaks and the activity calendar (#15, #60), from each attempt's local date.

export const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

export function byDay(attempts: HistoryAttempt[]) {
  const days = new Map<string, HistoryAttempt[]>();
  for (const a of attempts) days.set(a.localDate, [...(days.get(a.localDate) ?? []), a]);
  return days;
}

export interface Streaks {
  current: number;
  longest: { days: number; from: string; to: string } | null;
  activeDays: number;
  first: string | null;
}

// The current streak breaks only after a full day with no attempt (#60): if today has none yet,
// it still counts through yesterday.
export function streaks(activeDates: Iterable<string>, today: string): Streaks {
  const days = new Set([...activeDates].filter((d) => d <= today));
  let current = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) current++;

  const sorted = [...days].sort();
  let longest: Streaks["longest"] = null;
  let from = sorted[0];
  sorted.forEach((d, i) => {
    if (i > 0 && daysBetween(sorted[i - 1], d) !== 1) from = d;
    const length = daysBetween(from, d) + 1;
    if (!longest || length > longest.days) longest = { days: length, from, to: d };
  });
  return { current, longest, activeDays: days.size, first: sorted[0] ?? null };
}

export interface CalendarDay {
  date: string;
  count: number;
  blank: boolean; // after today, or before your first attempt
}

export interface CalendarWeek {
  start: string; // Monday
  month: string | null; // a label when a month starts in this week (or it's the first column)
  days: CalendarDay[];
}

// A rolling 12 months ending today, one column per week starting Monday (#60).
export function calendar(counts: Map<string, number>, today: string, first: string | null): CalendarWeek[] {
  const start = mondayOf(addDays(today, -364));
  const weeks: CalendarWeek[] = [];
  for (let monday = start; monday <= today; monday = addDays(monday, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i);
      return { date, count: counts.get(date) ?? 0, blank: date > today || !first || date < first };
    });
    const opens = days.find((d) => d.date.endsWith("-01"));
    const labelDate = opens?.date ?? (weeks.length === 0 ? monday : null);
    weeks.push({ start: monday, month: labelDate && monthName(labelDate), days });
  }
  return weeks;
}

const monthName = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
};

// Five grays from none to 4+ attempts.
export const level = (count: number) => Math.min(count, 4);
