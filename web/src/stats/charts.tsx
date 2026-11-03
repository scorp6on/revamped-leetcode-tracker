import { useState, type ReactNode } from "react";
import type { Range } from "../../../api/src/stats/types";
import { bucketLabel, linePath, points } from "./geometry";

// Hand-made charts (#59): thin marks, recessive grid, hover or tap a week for its values, and a
// hidden table so screen readers get the numbers too.

export interface Series {
  name: string;
  color: string; // a CSS color; text color unless the series is a difficulty
  values: (number | null)[];
}

interface Frame {
  starts: string[]; // bucket start dates
  range: Range;
  format: (v: number) => string;
  caption: string;
}

const XLabels = ({ starts, range }: Pick<Frame, "starts" | "range">) => {
  const picks = starts.length > 2 ? [0, Math.floor((starts.length - 1) / 2), starts.length - 1] : starts.map((_, i) => i);
  return (
    <div className="flex justify-between text-[11px] text-muted-foreground">
      {picks.map((i) => (
        <span key={i}>{bucketLabel(starts[i], range)}</span>
      ))}
    </div>
  );
};

// Hover columns over each bucket, and the tooltip for the one under the pointer or finger.
function HoverLayer({ count, tooltip }: { count: number; tooltip: (i: number) => ReactNode }) {
  const [active, setActive] = useState<number | null>(null);
  const step = count > 1 ? 100 / (count - 1) : 100;
  const x = (i: number) => (count > 1 ? i * step : 50);
  return (
    <div className="absolute inset-0" onMouseLeave={() => setActive(null)}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="absolute inset-y-0"
          style={{ left: `${Math.max(0, x(i) - step / 2)}%`, width: `${count > 1 ? step : 100}%` }}
          onMouseEnter={() => setActive(i)}
          onClick={() => setActive((a) => (a === i ? null : i))}
        />
      ))}
      {active !== null && (
        <>
          <div className="pointer-events-none absolute inset-y-0 border-l border-dashed" style={{ left: `${x(active)}%` }} />
          <div
            role="presentation"
            className="pointer-events-none absolute -top-2 z-10 rounded-lg border bg-background px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md"
            style={{
              left: `${x(active)}%`,
              transform: `translate(${x(active) < 20 ? "0" : x(active) > 80 ? "-100%" : "-50%"}, -100%)`,
            }}
          >
            {tooltip(active)}
          </div>
        </>
      )}
    </div>
  );
}

const Grid = () => (
  <>
    <div className="absolute inset-x-0 top-0 border-t border-border/60" />
    <div className="absolute inset-x-0 top-1/2 border-t border-border/60" />
  </>
);

export function LineChart({ series, max, ...frame }: Frame & { series: Series[]; max: number }) {
  const { starts, range, format, caption } = frame;
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-1.5 gap-y-1.5">
        <div aria-hidden="true" className="flex h-36 flex-col justify-between text-right text-[11px] text-muted-foreground">
          <span>{format(max)}</span>
          <span>{format(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative h-36 border-b">
          <Grid />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
            {series.map((s) => (
              <path
                key={s.name}
                d={linePath(s.values, max)}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>
          {series.map((s) =>
            points(s.values, max).map(
              (p, i) =>
                p && (
                  <span
                    key={`${s.name}${i}`}
                    aria-hidden="true"
                    className="absolute size-2 -translate-1/2 rounded-full ring-2 ring-background"
                    style={{ left: `${p.x}%`, top: `${p.y}%`, background: s.color }}
                  />
                ),
            ),
          )}
          <HoverLayer
            count={starts.length}
            tooltip={(i) => (
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{bucketLabel(starts[i], range)}</span>
                {series.map((s) => (
                  <span key={s.name}>
                    {series.length > 1 && `${s.name}: `}
                    {s.values[i] === null ? "no data" : format(s.values[i]!)}
                  </span>
                ))}
              </div>
            )}
          />
        </div>
        <span />
        <XLabels starts={starts} range={range} />
      </div>
      <DataTable caption={caption} starts={starts} range={range} series={series} format={format} />
    </figure>
  );
}

// Vertical bars, 0–100.
export function BarChart({ values, detail, ...frame }: Frame & { values: (number | null)[]; detail: (i: number) => string }) {
  const { starts, range, format, caption } = frame;
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div className="relative flex h-20 items-end gap-0.5 border-b">
        {values.map((v, i) => (
          <span
            key={starts[i]}
            aria-hidden="true"
            className="flex-1 rounded-t bg-muted-foreground/60"
            style={{ height: `${v ?? 0}%` }}
          />
        ))}
        <HoverLayer
          count={values.length}
          tooltip={(i) => (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{bucketLabel(starts[i], range)}</span>
              <span>{detail(i)}</span>
            </div>
          )}
        />
      </div>
      <XLabels starts={starts} range={range} />
      <DataTable caption={caption} starts={starts} range={range} series={[{ name: "Value", color: "", values }]} format={format} />
    </figure>
  );
}

// One small bar per bucket, for a table row.
export function MiniBars({ counts, label }: { counts: number[]; label: string }) {
  const top = Math.max(2, ...counts);
  return (
    <span role="img" aria-label={label} className="flex h-5 items-end gap-px border-b">
      {counts.map((c, i) => (
        <span key={i} className="flex-1 rounded-t-[1px] bg-foreground" style={{ height: c ? `${Math.max(15, (c / top) * 100)}%` : 0 }} />
      ))}
    </span>
  );
}

function DataTable({ caption, starts, range, series, format }: Frame & { series: Series[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{range === "all" ? "Month" : "Week of"}</th>
          {series.map((s) => (
            <th key={s.name} scope="col">
              {s.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {starts.map((start, i) => (
          <tr key={start}>
            <th scope="row">{bucketLabel(start, range)}</th>
            {series.map((s) => (
              <td key={s.name}>{s.values[i] === null ? "no data" : format(s.values[i]!)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
