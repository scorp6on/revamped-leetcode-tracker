import { useState } from "react";
import { Link } from "react-router";
import type { Difficulty } from "../../../api/src/catalog/types";
import { OUTCOMES, type HistoryAttempt, type Outcome } from "../../../api/src/review/types";
import { DifficultyBadge } from "../components/DifficultyBadge";
import { Input } from "../components/ui/input";
import { shortDate } from "../queue/useSchedule";
import { OUTCOME_LABEL, resultLine } from "./Calendar";
import { filterHistory, type HistoryFilter } from "./search";

const PAGE = 25;
const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];
const selectClass =
  "h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Every attempt, newest first, with search and filters (#15, #60).
export function History({
  attempts,
  isReview,
  topics,
  filter,
  onFilter,
}: {
  attempts: HistoryAttempt[];
  isReview: (a: HistoryAttempt) => boolean;
  topics: [string, string][]; // slug, name
  filter: HistoryFilter;
  onFilter: (f: Partial<HistoryFilter>) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const list = filterHistory(attempts, filter);
  const set = (f: Partial<HistoryFilter>) => {
    setShown(PAGE);
    onFilter(f);
  };

  return (
    <section aria-label="History" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Search problems"
          placeholder="Search problems"
          value={filter.q}
          onChange={(e) => set({ q: e.target.value })}
          className="h-11 min-w-0 flex-[1_1_200px]"
        />
        <select aria-label="Outcome" value={filter.outcome} onChange={(e) => set({ outcome: e.target.value as Outcome | "" })} className={selectClass}>
          <option value="">Any outcome</option>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABEL[o]}
            </option>
          ))}
        </select>
        <select aria-label="Difficulty" value={filter.difficulty} onChange={(e) => set({ difficulty: e.target.value as Difficulty | "" })} className={selectClass}>
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select aria-label="Topic" value={filter.tag} onChange={(e) => set({ tag: e.target.value })} className={`${selectClass} max-w-full`}>
          <option value="">Any topic</option>
          {topics.map(([slug, name]) => (
            <option key={slug} value={slug}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {list.length === attempts.length ? `${attempts.length} attempts` : `${list.length} of ${attempts.length} attempts`} · newest first ·
        tap a problem to open it and see its timeline
      </p>
      {list.length === 0 ? (
        <p className="rounded-[10px] border border-dashed px-4 py-6 text-center text-muted-foreground">
          {attempts.length ? "No attempts match these filters." : "No attempts yet. They'll show up here as you log them."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-[10px] border">
          {list.slice(0, shown).map((a) => (
            <li key={a.createdAt} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className="w-[92px] text-[13px] text-muted-foreground">{shortDate(a.localDate)}</span>
              <Link to={`/problems/${a.slug}`} className="min-w-0 flex-[1_1_220px] font-medium hover:underline">
                <span className="font-mono text-muted-foreground">{a.problemId}.</span> {a.title}
              </Link>
              <DifficultyBadge difficulty={a.difficulty} />
              <span className="text-[13px] text-muted-foreground sm:w-[270px]">
                <span className="font-medium text-foreground">{OUTCOME_LABEL[a.outcome]}</span> · {resultLine(a)}
                {!a.failureMode && (isReview(a) ? " · review" : " · first try")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {list.length > shown && (
        <button
          type="button"
          className="h-11 self-center rounded-lg border px-4 font-medium hover:bg-subtle"
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show {Math.min(PAGE, list.length - shown)} more
        </button>
      )}
    </section>
  );
}
