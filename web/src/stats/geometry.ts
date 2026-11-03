import type { Range } from "../../../api/src/stats/types";

export const RANGE_LABEL: Record<Range, string> = { "4w": "last 4 weeks", "12w": "last 12 weeks", all: "all time" };

// Points in a 0–100 box (y down), one per bucket; null values get no point.
export function points(values: (number | null)[], max: number) {
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  return values.map((v, i) => (v === null ? null : { x: values.length > 1 ? i * step : 50, y: 100 - (Math.min(v, max) / max) * 100 }));
}

// An SVG path through the points; a missing value lifts the pen, so gaps aren't drawn as data.
export function linePath(values: (number | null)[], max: number) {
  let pen = false;
  return points(values, max)
    .map((p) => {
      if (!p) return (pen = false), "";
      const cmd = pen ? "L" : "M";
      pen = true;
      return `${cmd}${+p.x.toFixed(2)} ${+p.y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");
}

// A round axis top a bit above the largest value: 10, 20, 30, 50, 70, 100, 150…
export function niceMax(values: (number | null)[]) {
  const top = Math.max(0, ...values.map((v) => v ?? 0));
  const steps = [10, 20, 30, 50, 70, 100, 150, 200, 300, 400, 600];
  return steps.find((s) => s >= top * 1.1) ?? Math.ceil(top / 100) * 100;
}

// "Aug 17" for a week, "Aug 2026" for a month.
export function bucketLabel(start: string, range: Range) {
  const [y, m, d] = start.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return range === "all"
    ? date.toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const readinessWord = (score: number) => (score >= 70 ? "Ready" : score >= 40 ? "Shaky" : "Not ready");

// Compared with the 4 weeks before: "↓ 3", "↑ 1", "= 2".
export const changeLabel = (last: number, prev: number) => `${last < prev ? "↓" : last > prev ? "↑" : "="} ${prev}`;
