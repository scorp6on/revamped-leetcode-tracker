import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { FAILURE_MODES, type HistoryAttempt } from "../../../api/src/review/types";
import { DifficultyBadge } from "../components/DifficultyBadge";
import { shortDate } from "../queue/useSchedule";
import { level, type CalendarWeek } from "./activity";

// Five grays from none to 4+ attempts; color stays on difficulty only (#40).
const SHADES = ["bg-subtle", "bg-muted-foreground/25", "bg-muted-foreground/50", "bg-muted-foreground/80", "bg-foreground"];
const ROW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const plural = (n: number) => `${n} attempt${n === 1 ? "" : "s"}`;

export const OUTCOME_LABEL = { solved: "Solved", struggled: "Struggled", failed: "Failed" } as const;
export const resultLine = (a: HistoryAttempt) =>
  [`confidence ${a.confidence}`, `${a.minutes} min`, a.failureMode && FAILURE_MODES[a.failureMode]].filter(Boolean).join(" · ");

// The activity calendar (#15, #60): hover or tap a day for its count; clicking opens the day's
// attempts in a panel underneath.
export function Calendar({
  weeks,
  total,
  attemptsOn,
  selected,
  onSelect,
}: {
  weeks: CalendarWeek[];
  total: number;
  attemptsOn: (date: string) => HistoryAttempt[];
  selected: string | null;
  onSelect: (date: string | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null);
  // On a narrow screen the grid scrolls; start at the newest week.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, []);
  const day = selected ? attemptsOn(selected) : [];

  return (
    <section className="flex flex-col gap-3 rounded-[10px] border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Activity</h2>
        <span className="text-[13px] text-muted-foreground">{plural(total)} in the last year</span>
      </div>
      <div ref={scroller} className="overflow-x-auto pt-1">
        <div className="relative ml-auto grid w-max grid-cols-[28px_auto] gap-x-1.5 gap-y-1" onMouseLeave={() => setTip(null)}>
          <span />
          <div aria-hidden="true" className="flex h-3.5 gap-0.5 text-[11px] leading-none text-muted-foreground">
            {weeks.map((w) => (
              <span key={w.start} className="w-[11px] overflow-visible whitespace-nowrap">
                {w.month}
              </span>
            ))}
          </div>
          <div aria-hidden="true" className="grid grid-rows-[repeat(7,11px)] gap-0.5 text-[10px] leading-[11px] text-muted-foreground">
            {ROW_LABELS.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
          <div className="flex gap-0.5">
            {weeks.map((w) => (
              <div key={w.start} className="grid grid-rows-[repeat(7,11px)] gap-0.5">
                {w.days.map((d) =>
                  d.blank ? (
                    <span key={d.date} className="size-[11px]" />
                  ) : (
                    <button
                      key={d.date}
                      type="button"
                      aria-label={`${shortDate(d.date)}: ${plural(d.count)}`}
                      aria-pressed={d.date === selected}
                      className={`size-[11px] rounded-[2px] ${SHADES[level(d.count)]} ${
                        d.date === selected ? "outline-2 outline-offset-1 outline-foreground" : ""
                      }`}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget;
                        setTip({ text: `${shortDate(d.date)}: ${plural(d.count)}`, left: el.offsetLeft + 5, top: el.offsetTop });
                      }}
                      onFocus={(e) => {
                        const el = e.currentTarget;
                        setTip({ text: `${shortDate(d.date)}: ${plural(d.count)}`, left: el.offsetLeft + 5, top: el.offsetTop });
                      }}
                      onBlur={() => setTip(null)}
                      onClick={() => onSelect(d.date === selected ? null : d.date)}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
          {tip && (
            <div
              role="presentation"
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-background px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md"
              style={{ left: tip.left, top: tip.top - 6 }}
            >
              {tip.text}
            </div>
          )}
        </div>
      </div>
      <div aria-hidden="true" className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
        Less
        {SHADES.map((s) => (
          <span key={s} className={`size-[11px] rounded-[2px] ${s}`} />
        ))}
        More · tap a day for its attempts
      </div>

      {selected && (
        <div aria-live="polite" className="flex flex-col border-t pt-2">
          <div className="flex items-center gap-2">
            <strong className="font-semibold">{shortDate(selected)}</strong>
            <span className="text-[13px] text-muted-foreground">{plural(day.length)}</span>
            <button
              type="button"
              aria-label="Close"
              className="ml-auto size-11 text-lg text-muted-foreground hover:text-foreground"
              onClick={() => onSelect(null)}
            >
              ×
            </button>
          </div>
          {day.length === 0 && <p className="pb-2 text-muted-foreground">No attempts that day.</p>}
          <ul className="flex flex-col divide-y">
            {day.map((a) => (
              <li key={a.createdAt}>
                <Link to={`/problems/${a.slug}`} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <span className="min-w-0 flex-[1_1_200px] font-medium">
                    <span className="font-mono text-muted-foreground">{a.problemId}.</span> {a.title}
                  </span>
                  <DifficultyBadge difficulty={a.difficulty} />
                  <span className="text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground">{OUTCOME_LABEL[a.outcome]}</span> · {resultLine(a)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
