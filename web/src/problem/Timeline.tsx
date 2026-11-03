import { useEffect, useRef, useState } from "react";
import type { Attempt } from "../../../api/src/review/types";
import { timelineDots, type TimelineDot } from "./timelineDots";

const LABEL_PX = 64; // room each dot's labels need
const WORD: Record<TimelineDot["kind"], string> = { solved: "Solved", struggled: "Struggled", failed: "Failed", next: "Next" };

const short = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// Filled = Solved, half = Struggled, ring = Failed, dashed = the next review.
const dotStyle = (kind: TimelineDot["kind"]) =>
  kind === "solved"
    ? "border-foreground bg-foreground"
    : kind === "struggled"
      ? "border-foreground bg-[linear-gradient(90deg,var(--foreground)_50%,var(--background)_50%)]"
      : kind === "failed"
        ? "border-foreground bg-background"
        : "border-dashed border-muted-foreground bg-background";

// One problem's attempts over time, on its problem page above Past attempts (#60).
export function Timeline({ attempts, due }: { attempts: Attempt[]; due: string | null }) {
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!track.current) return;
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width || 600));
    observer.observe(track.current);
    return () => observer.disconnect();
  }, []);

  const dots = timelineDots(attempts, due, (LABEL_PX / width) * 100);
  if (!dots.length) return null;
  const summary = dots.map((d) => `${short(d.date)} ${WORD[d.kind]}`).join(", ");

  return (
    <div className="flex flex-col gap-2 px-5 pt-4 pb-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Timeline</span>
        <span className="text-[13px] text-muted-foreground">
          since {short(dots[0].date)}
          {due && ` · next review ${short(due)}`}
        </span>
      </div>
      <div className="px-8">
        <div ref={track} role="img" aria-label={`Timeline: ${summary}`} className="relative h-[86px]">
          <div className="absolute inset-x-0 top-[7px] border-t-2" />
          {dots.map((d, i) => (
            <div
              key={i}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1 text-center"
              style={{ left: `${d.x}%`, width: LABEL_PX }}
            >
              <span
                title={`${short(d.date)}: ${WORD[d.kind]} · ${d.gap}`}
                className={`size-3.5 rounded-full border-2 ring-[3px] ring-background ${dotStyle(d.kind)}`}
              />
              {d.labelled && (
                <>
                  <span className="text-xs font-medium">{short(d.date)}</span>
                  <span className="text-xs text-muted-foreground">{WORD[d.kind]}</span>
                  <span className="text-[11px] text-muted-foreground/70">{d.gap}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        ● Solved · ◐ Struggled · ○ Failed · dashed = next review · small text = days since the attempt before
      </p>
    </div>
  );
}
