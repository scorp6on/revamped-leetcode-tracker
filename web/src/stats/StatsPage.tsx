import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { RANGES, type Range, type StatsResponse } from "../../../api/src/stats/types";
import { api } from "../api";
import { cn } from "../lib/utils";
import { localToday } from "../queue/rank";
import { FailureTrend, Gaps, MockOa, Prediction, Readiness, Recognition, Retention, Tiles, TimeToSolve } from "./cards";
import { RANGE_LABEL } from "./geometry";

const RANGE_BUTTON: Record<Range, string> = { "4w": "4 weeks", "12w": "12 weeks", all: "All time" };

// The Stats page (#16, #59). The range lives in the URL, so Back and refresh keep it.
export function StatsPage() {
  const [params, setParams] = useSearchParams();
  const range: Range = (RANGES as readonly string[]).includes(params.get("range") ?? "") ? (params.get("range") as Range) : "12w";
  const [data, setData] = useState<StatsResponse | "loading" | "error">("loading");

  useEffect(() => {
    let live = true;
    api(`/api/stats?range=${range}&today=${localToday()}`)
      .then((res) => (res.ok ? (res.json() as Promise<StatsResponse>) : Promise.reject(res.status)))
      .then((d) => live && setData(d))
      .catch(() => live && setData("error"));
    return () => {
      live = false;
    };
  }, [range]);

  // While a new range loads, the old numbers stay up instead of flashing to "Loading".
  const s = typeof data === "object" ? data : undefined;

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] font-semibold tracking-tight">Stats</h1>
          <p className="text-muted-foreground">
            {s
              ? `From ${s.totals.attempts} attempts on ${s.totals.problems} problems · trends show ${RANGE_LABEL[range]}`
              : "Your progress, from the attempts you've logged"}
          </p>
        </div>
        <div role="group" aria-label="Range" className="flex rounded-lg border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => setParams(r === "12w" ? {} : { range: r })}
              className={cn(
                "h-10 rounded-md px-3 text-[13px] font-medium",
                r === range ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {RANGE_BUTTON[r]}
            </button>
          ))}
        </div>
      </div>

      {data === "error" && <p role="alert">Couldn't load your stats. Refresh to try again.</p>}
      {!s && data === "loading" && <p className="text-muted-foreground">Loading…</p>}
      {s && (
        <>
          <Tiles s={s} />
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
            <Readiness s={s} />
            <Recognition s={s} />
            <Prediction s={s} />
            <TimeToSolve s={s} />
            <Retention s={s} />
            <FailureTrend s={s} />
            <Gaps s={s} />
            <MockOa />
          </div>
        </>
      )}
    </main>
  );
}
