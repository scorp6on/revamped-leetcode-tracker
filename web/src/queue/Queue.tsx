import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ScheduleResponse } from "../../../api/src/review/types";
import { DifficultyBadge } from "../components/DifficultyBadge";
import { buildQueue, localToday, type QueueItem } from "./rank";

// Today → Upcoming (next 2 days) → collapsed Overdue (#8).
export function Queue({ data }: { data: ScheduleResponse | "loading" | "error" }) {
  if (data === "loading") return <p className="text-muted-foreground">Loading your queue…</p>;
  if (data === "error") return <p role="alert">Couldn't load your queue. Try reloading.</p>;

  const q = buildQueue(data.schedules, data.recentFailures, localToday());
  if (data.schedules.length === 0) {
    return (
      <Section title="Today">
        <p className="text-muted-foreground">Nothing scheduled yet. Record an attempt on any problem to start your queue.</p>
      </Section>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Section title="Today" count={q.today.length}>
        {q.today.length ? <Rows items={q.today} /> : <p className="text-muted-foreground">Nothing due today.</p>}
      </Section>
      <Section title="Upcoming" count={q.upcoming.length}>
        {q.upcoming.length ? (
          <Rows items={q.upcoming} />
        ) : (
          <p className="text-muted-foreground">Nothing due in the next 2 days.</p>
        )}
      </Section>
      {q.overdue.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xl font-semibold tracking-tight">
            <span aria-hidden="true" className="text-sm text-muted-foreground transition-transform group-open:rotate-90">
              ▶
            </span>
            Overdue
            <span className="font-mono text-[13px] font-normal text-muted-foreground">{q.overdue.length}</span>
          </summary>
          <div className="mt-3">
            <Rows items={q.overdue} />
          </div>
        </details>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const id = `queue-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="flex items-baseline gap-3 text-xl font-semibold tracking-tight">
        {title}
        {count !== undefined && <span className="font-mono text-[13px] font-normal text-muted-foreground">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Rows({ items }: { items: QueueItem[] }) {
  return (
    <ul className="divide-y rounded-[10px] border">
      {items.map(({ schedule: s, reason }) => (
        <li key={s.problemId}>
          {/* Stacks on a phone; one line from sm up. */}
          <Link
            to={`/problems/${s.slug}`}
            className="flex flex-col gap-1.5 px-4 py-3 hover:bg-subtle sm:flex-row sm:items-center sm:gap-4"
          >
            <span className="flex items-center gap-3 font-medium">
              <span className="font-mono text-[13px] text-muted-foreground">{s.problemId}</span>
              {s.title}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:ml-auto">
              <span className="text-[13px] text-muted-foreground">{reason.join(" · ")}</span>
              <DifficultyBadge difficulty={s.difficulty} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
