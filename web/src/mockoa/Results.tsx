import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Catalog } from "../../../api/src/catalog/types";
import { PASS_RATIO, type SessionView } from "../../../api/src/mockoa/types";
import { DifficultyBadge } from "../components/DifficultyBadge";
import { Button } from "../components/ui/button";
import { localToday } from "../queue/rank";
import { shortDate } from "../queue/useSchedule";
import { minutesOf, passes, pct, prefillFor } from "./helpers";
import type { MockOaPrefill } from "./prefill";

// After the test: titles and topics come back, and each problem can be recorded like any attempt (#62).
export function Results({ session }: { session: SessionView }) {
  const navigate = useNavigate();
  const [topicNames, setTopicNames] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/data/catalog.json")
      .then((res) => (res.ok ? (res.json() as Promise<Catalog>) : null))
      .then((c) => c && setTopicNames(c.tags))
      .catch(() => {});
  }, []);

  const s = session.summary!;
  const day = shortDate(localToday(new Date(session.createdAt)));
  const difficulties = [...new Set(session.problems.map((p) => p.revealed?.difficulty))].filter(Boolean).join(" + ");
  const recorded = session.problems.filter((p) => p.recorded).length;

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <span className="text-[13px] text-muted-foreground">
            Mock OA · {day} · {difficulties}
          </span>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">
            {s.passedProblems} of {session.count} passed
          </h1>
        </div>
        {[
          ["Score", `${pct(s.testsPassed, s.testsTotal)}%`],
          ["Tests", `${s.testsPassed} / ${s.testsTotal}`],
          ["Time used", `${s.usedMinutes} of ${session.minutes} min`],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-[22px] font-semibold tabular-nums">{value}</span>
          </div>
        ))}
      </div>

      <section aria-labelledby="record-h" className="rounded-[10px] border">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-5 py-3.5">
          <h2 id="record-h" className="text-base font-semibold">
            Record each problem
          </h2>
          <span className="text-[13px] text-muted-foreground">
            Recording schedules the next review and starts the AI review, like any other attempt. {recorded} of {session.count} recorded.
          </span>
        </div>
        <ul className="divide-y">
          {session.problems.map((p) => {
            const r = p.revealed!;
            const best = p.best ?? { passed: 0, total: p.examples.length };
            const share = pct(best.passed, best.total);
            const minutes = minutesOf(p.activeMs);
            const fill = prefillFor(session, p);
            const prefill: MockOaPrefill = {
              sessionId: session.id,
              index: p.index,
              outcome: fill.outcome,
              failureMode: fill.failureMode,
              minutes,
              summary: `mock OA on ${day} · ${best.passed} of ${best.total} tests`,
            };
            return (
              <li key={p.index} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_150px_90px_170px] md:items-center">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    <Link to={`/problems/${r.slug}`} className="hover:underline">
                      <span className="font-mono text-muted-foreground">{r.problemId}.</span> {r.title}
                    </Link>
                    <DifficultyBadge difficulty={r.difficulty} />
                  </span>
                  <span className="text-[13px] text-muted-foreground">Your approach: {p.approach ?? "none locked"}</span>
                  <span className="text-xs text-muted-foreground">Topics: {r.tags.map((t) => topicNames[t] ?? t).join(", ") || "none"}</span>
                  {p.code !== p.stub && (
                    <details>
                      <summary className="flex min-h-11 cursor-pointer items-center text-[13px] text-muted-foreground">Your code</summary>
                      <pre className="overflow-x-auto rounded-lg border bg-subtle p-3 font-mono text-[13px] leading-normal">{p.code}</pre>
                    </details>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="tabular-nums">
                    <strong className="font-semibold">{share}%</strong> <span className="text-muted-foreground">· {best.passed} / {best.total} tests</span>
                  </span>
                  <span className="relative h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground" style={{ width: `${share}%` }} />
                    <span className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${PASS_RATIO * 100}%` }} />
                  </span>
                  <span className="text-xs text-muted-foreground">{passes(p.best) ? "✓ passed" : `× not passed (${PASS_RATIO * 100}% needed)`}</span>
                </div>
                <span className="tabular-nums">{minutes} min</span>
                <div className="flex md:justify-end">
                  {p.recorded ? (
                    <span className="text-[13px] text-muted-foreground">Recorded</span>
                  ) : (
                    <Button className="h-10" onClick={() => navigate(`/problems/${r.slug}`, { state: { mockOa: prefill } })}>
                      Record · {fill.outcome === "solved" ? "Solved" : "Failed"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <Link to="/mock-oa" className="self-start py-2 text-muted-foreground hover:text-foreground">
        ← Mock OA
      </Link>
    </main>
  );
}
