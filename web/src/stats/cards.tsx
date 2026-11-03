import type { ReactNode } from "react";
import { Link } from "react-router";
import { FAILURE_MODES } from "../../../api/src/review/types";
import type { ModeCount, StatsResponse } from "../../../api/src/stats/types";
import { BarChart, LineChart, MiniBars } from "./charts";
import { changeLabel, niceMax, RANGE_LABEL, readinessWord } from "./geometry";

// The summary tiles and the eight cards of #16, with the definitions from #59.

const pct = (v: number) => `${Math.round(v)}%`;
const mins = (v: number) => `${Math.round(v)} m`;

function Card({ title, about, children, foot }: { title: string; about: string; children: ReactNode; foot?: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-3.5 rounded-[10px] border p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{about}</p>
      </div>
      {children}
      {foot && <p className="text-xs text-muted-foreground">{foot}</p>}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-[10px] border border-dashed px-4 py-6 text-center text-muted-foreground">{children}</p>
);

const Big = ({ value, note }: { value: string; note: string }) => (
  <div className="flex flex-wrap items-baseline gap-2">
    <span className="text-[26px] font-semibold tabular-nums">{value}</span>
    <span className="text-[13px] text-muted-foreground">{note}</span>
  </div>
);

export function Tiles({ s }: { s: StatsResponse }) {
  const range = RANGE_LABEL[s.range];
  const tiles = [
    { label: "Attempts this week", value: String(s.tiles.thisWeek.attempts), note: `${s.tiles.thisWeek.reviews} reviews · ${s.tiles.thisWeek.fresh} new` },
    { label: "Review retention", value: s.tiles.retention === null ? "–" : pct(s.tiles.retention), note: range },
    { label: "Prediction accuracy", value: s.tiles.prediction === null ? "–" : pct(s.tiles.prediction), note: range },
    { label: "Medium solve time", value: s.tiles.mediumMinutes === null ? "–" : `${s.tiles.mediumMinutes} min`, note: `median, ${range}` },
  ];
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="flex flex-col gap-0.5 rounded-[10px] border px-4 py-3.5">
          <span className="text-[13px] text-muted-foreground">{t.label}</span>
          <span className="text-[26px] font-semibold tracking-tight tabular-nums">{t.value}</span>
          <span className="text-xs text-muted-foreground">{t.note}</span>
        </div>
      ))}
    </section>
  );
}

export function Readiness({ s }: { s: StatsResponse }) {
  return (
    <Card
      title="Pattern readiness"
      about="How interview-ready each topic is, 0–100: each problem scores its latest grade, halved if its review is overdue, and the topic is the average."
      foot={s.readiness.length ? "Ready 70+ · Shaky 40–69 · Not ready under 40 · topics with 3+ attempted problems" : undefined}
    >
      {s.readiness.length ? (
        <ul className="flex flex-col gap-2.5">
          {s.readiness.map((r) => (
            <li key={r.tag} className="grid grid-cols-[minmax(0,9.5em)_minmax(0,1fr)_6.5em] items-center gap-2.5">
              <span className="truncate" title={`${r.name} · ${r.problems} problems`}>
                {r.name}
              </span>
              <span className="h-2 overflow-hidden rounded bg-subtle">
                <span className="block h-full rounded bg-foreground" style={{ width: `${r.score}%` }} />
              </span>
              <span className="text-[13px] tabular-nums">
                {r.score} <span className="text-muted-foreground">{readinessWord(r.score)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Not enough data yet: a topic shows once you've attempted 3 of its problems.</Empty>
      )}
    </Card>
  );
}

const ModeList = ({ modes }: { modes: ModeCount[] }) =>
  modes.map((m) => (
    <span key={m.mode} className="flex justify-between gap-2 text-[13px] text-muted-foreground">
      <span>{FAILURE_MODES[m.mode]}</span>
      <span className="tabular-nums">{m.count}</span>
    </span>
  ));

export function Recognition({ s }: { s: StatsResponse }) {
  const sum = (ms: ModeCount[]) => ms.reduce((n, m) => n + m.count, 0);
  const rec = sum(s.recognition.recognition);
  const exe = sum(s.recognition.execution);
  const total = rec + exe;
  return (
    <Card
      title="Recognition vs. execution"
      about="When an attempt went wrong: did you miss which pattern to use (recognition), or pick the right one and slip on the code (execution)?"
      foot={total ? `${total} failure modes picked, ${RANGE_LABEL[s.range]}` : undefined}
    >
      {total ? (
        <>
          <div className="flex h-7 gap-0.5" role="img" aria-label={`Recognition ${rec}, execution ${exe}`}>
            {rec > 0 && <span className="rounded-l bg-foreground last:rounded-r" style={{ flex: rec }} />}
            {exe > 0 && <span className="rounded-r bg-muted-foreground/60 first:rounded-l" style={{ flex: exe }} />}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 font-medium">
                <span className="size-2.5 rounded-sm bg-foreground" />
                Recognition · {Math.round((rec / total) * 100)}%
              </span>
              <ModeList modes={s.recognition.recognition} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 font-medium">
                <span className="size-2.5 rounded-sm bg-muted-foreground/60" />
                Execution · {Math.round((exe / total) * 100)}%
              </span>
              <ModeList modes={s.recognition.execution} />
            </div>
          </div>
        </>
      ) : (
        <Empty>No Struggled or Failed attempts in this range.</Empty>
      )}
    </Card>
  );
}

const startsOf = (s: StatsResponse) => s.prediction.buckets.map((b) => b.start);

export function Prediction({ s }: { s: StatsResponse }) {
  const values = s.prediction.buckets.map((b) => b.value);
  return (
    <Card
      title="Prediction accuracy"
      about="How often the approach you predicted before starting was right. Graded by the AI review: Correct counts 1, Partial counts ½."
      foot={`Only attempts with an AI review count · ${s.prediction.graded} of ${s.prediction.predicted} predictions graded`}
    >
      {s.prediction.graded ? (
        <>
          <Big value={pct(s.tiles.prediction!)} note={RANGE_LABEL[s.range]} />
          <LineChart
            series={[{ name: "Accuracy", color: "var(--foreground)", values }]}
            max={100}
            starts={startsOf(s)}
            range={s.range}
            format={pct}
            caption="Prediction accuracy"
          />
        </>
      ) : (
        <Empty>No graded predictions in this range.</Empty>
      )}
    </Card>
  );
}

export function TimeToSolve({ s }: { s: StatsResponse }) {
  const series = (["Easy", "Medium", "Hard"] as const).map((d) => ({
    name: d,
    color: `var(--${d.toLowerCase()})`,
    values: s.time[d].map((b) => b.value),
  }));
  const any = series.some((x) => x.values.some((v) => v !== null));
  const latest = (vs: (number | null)[]) => [...vs].reverse().find((v) => v !== null);
  return (
    <Card
      title="Time to solve"
      about="Median minutes for a Solved attempt, split by difficulty. Going down means you're getting faster."
      foot="Uses the minutes you enter when grading · weeks with no solve at a difficulty are left out"
    >
      {any ? (
        <>
          <div className="flex flex-wrap gap-4 text-[13px]">
            {series.map((x) => (
              <span key={x.name} className="flex items-center gap-1.5">
                <span className="h-0.5 w-3.5" style={{ background: x.color }} />
                {x.name}
                <span className="text-muted-foreground tabular-nums">
                  {latest(x.values) === undefined ? "no solves" : `${latest(x.values)} min latest`}
                </span>
              </span>
            ))}
          </div>
          <LineChart
            series={series}
            max={niceMax(series.flatMap((x) => x.values))}
            starts={startsOf(s)}
            range={s.range}
            format={mins}
            caption="Median minutes to solve"
          />
        </>
      ) : (
        <Empty>No solves in this range.</Empty>
      )}
    </Card>
  );
}

export function Retention({ s }: { s: StatsResponse }) {
  const b = s.retention.buckets;
  return (
    <Card
      title="Review retention"
      about="When a problem came back for review, how often you still solved it. This is the number spaced repetition is trying to keep high."
      foot="A review is any attempt on a problem you'd attempted before · first tries don't count"
    >
      {s.retention.reviews ? (
        <>
          <Big value={pct(s.retention.rate!)} note={`of ${s.retention.reviews} reviews solved · ${RANGE_LABEL[s.range]}`} />
          <BarChart
            values={b.map((x) => x.value)}
            detail={(i) => (b[i].n ? `${b[i].value}% of ${b[i].n} review${b[i].n === 1 ? "" : "s"}` : "no reviews")}
            starts={b.map((x) => x.start)}
            range={s.range}
            format={pct}
            caption="Review retention"
          />
        </>
      ) : (
        <Empty>No reviews in this range yet.</Empty>
      )}
    </Card>
  );
}

export function FailureTrend({ s }: { s: StatsResponse }) {
  return (
    <Card
      title="Failure-mode trend"
      about="Which mistakes are fading and which keep coming back. Each small bar is one week's count (one month's for All time)."
      foot={s.failureModes.length ? "The arrow compares the last 4 weeks with the 4 before" : undefined}
    >
      {s.failureModes.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)_84px_5.5em] items-center gap-x-3 gap-y-2 text-[13px]">
          <span className="text-xs text-muted-foreground">Mode</span>
          <span className="text-xs text-muted-foreground">{s.range === "all" ? "By month" : "By week"}</span>
          <span className="text-right text-xs text-muted-foreground">Last 4 wks</span>
          {s.failureModes.map((m) => (
            <div key={m.mode} className="contents">
              <span className="truncate">{FAILURE_MODES[m.mode]}</span>
              <MiniBars counts={m.buckets} label={`${FAILURE_MODES[m.mode]}: ${m.buckets.join(", ")}`} />
              <span className="text-right tabular-nums">
                {m.last} <span className="text-muted-foreground">{changeLabel(m.last, m.prev)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Empty>No failure modes picked in this range.</Empty>
      )}
    </Card>
  );
}

export function Gaps({ s }: { s: StatsResponse }) {
  return (
    <Card
      title="Coverage gaps"
      about="The least-practiced of the 20 topics with the most LeetCode problems."
      foot="Browse opens the catalog filtered to that topic"
    >
      <ul className="flex flex-col divide-y">
        {s.gaps.map((g) => (
          <li key={g.tag} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 py-1">
            <span className="font-medium">{g.name}</span>
            <span className="text-[13px] text-muted-foreground">
              {g.attempts} attempt{g.attempts === 1 ? "" : "s"} · {g.problems} problems
            </span>
            <Link to={`/?tag=${encodeURIComponent(g.tag)}`} className="ml-auto flex min-h-11 items-center text-[13px] text-muted-foreground hover:text-foreground">
              Browse →
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function MockOa() {
  return (
    <Card title="Mock OA scores" about="Your score on each timed mock online assessment, so you can see how you do under test conditions.">
      <Empty>No mock OAs yet. Scores show up here once Mock OA is built.</Empty>
    </Card>
  );
}
