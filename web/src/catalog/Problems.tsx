import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Catalog, Difficulty } from "../../../api/src/catalog/types";
import type { Schedule } from "../../../api/src/review/types";
import { DifficultyBadge } from "../components/DifficultyBadge";
import { shortDate } from "../queue/useSchedule";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import {
  DIFFICULTIES,
  PAGE_SIZE,
  filterCatalog,
  fromParams,
  pageOf,
  toParams,
  type CatalogQuery,
  type SortKey,
  type Status,
} from "./filter";

const STATUS_LABEL: Record<Status, string> = { "not-attempted": "—", attempted: "Attempted", solved: "Solved" };

const selectClass =
  "h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Premium">
    <title>Premium</title>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

// Kept after the first load, so coming back from a problem renders the list at once and the
// scroll position can be restored onto it.
let loaded: Catalog | undefined;

export function Problems({ schedules }: { schedules: Schedule[] }) {
  const [catalog, setCatalog] = useState<Catalog | "loading" | "error">(loaded ?? "loading");
  const bySlug = useMemo(() => new Map(schedules.map((s) => [s.slug, s])), [schedules]);
  const statusOf = useMemo(
    () =>
      (slug: string): Status => {
        const s = bySlug.get(slug);
        return !s ? "not-attempted" : s.solved ? "solved" : "attempted";
      },
    [bySlug],
  );
  const [params, setParams] = useSearchParams();
  const { query, page } = useMemo(() => fromParams(params), [params]);
  // replace: typing a search shouldn't add a Back-button step per keystroke.
  const setView = (q: CatalogQuery, p: number) => setParams(toParams(q, p), { replace: true });
  const setPage = (p: number) => setView(query, p);

  useEffect(() => {
    if (loaded) return;
    fetch("/data/catalog.json")
      .then((res) => (res.ok ? (res.json() as Promise<Catalog>) : Promise.reject(res.status)))
      .then((c) => setCatalog((loaded = c)))
      .catch(() => setCatalog("error"));
  }, []);

  const rows = useMemo(
    () => (typeof catalog === "object" ? filterCatalog(catalog.problems, query, statusOf) : []),
    [catalog, query, statusOf],
  );
  const tagOptions = useMemo(
    () =>
      typeof catalog === "object"
        ? Object.entries(catalog.tags).sort(([, a], [, b]) => a.localeCompare(b))
        : [],
    [catalog],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  // Any change to the search or filters starts again at page 1.
  const update = (patch: Partial<CatalogQuery>) => setView({ ...query, ...patch }, 0);
  const toggleDifficulty = (d: Difficulty) =>
    update({
      difficulties: query.difficulties.includes(d)
        ? query.difficulties.filter((x) => x !== d)
        : [...query.difficulties, d],
    });
  const sortBy = (sort: SortKey) =>
    update({ sort, descending: query.sort === sort ? !query.descending : false });
  const ariaSort = (key: SortKey) =>
    query.sort === key ? (query.descending ? "descending" : "ascending") : "none";

  const SortHeader = ({ label, sortKey, className }: { label: string; sortKey: SortKey; className?: string }) => (
    <th scope="col" aria-sort={ariaSort(sortKey)} className={cn("px-4 py-2.5 font-medium", className)}>
      <button onClick={() => sortBy(sortKey)} className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground">
        {label}
        <span aria-hidden="true">{query.sort === sortKey ? (query.descending ? "↓" : "↑") : ""}</span>
      </button>
    </th>
  );

  return (
    <section aria-labelledby="problems-h" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="problems-h" className="text-xl font-semibold tracking-tight">
          Problems
        </h2>
        {typeof catalog === "object" && (
          <span className="font-mono text-[13px] text-muted-foreground">
            {rows.length.toLocaleString()} of {catalog.problems.length.toLocaleString()}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="flex h-11 min-w-0 flex-[1_1_280px] items-center gap-2 rounded-lg border px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <SearchIcon />
          <span className="sr-only">Search problems</span>
          <Input
            value={query.text}
            onChange={(e) => update({ text: e.target.value })}
            placeholder="Search by title or number"
            className="h-auto border-0 p-0 text-foreground focus-visible:ring-0"
          />
        </label>
        <div role="group" aria-label="Difficulty" className="flex gap-1">
          {DIFFICULTIES.map((d) => (
            <Button
              key={d}
              variant={query.difficulties.includes(d) ? "default" : "outline"}
              size="sm"
              className="h-11"
              aria-pressed={query.difficulties.includes(d)}
              onClick={() => toggleDifficulty(d)}
            >
              {d}
            </Button>
          ))}
        </div>
        <label className="sr-only" htmlFor="topic">
          Topic
        </label>
        <select id="topic" value={query.tag} onChange={(e) => update({ tag: e.target.value })} className={selectClass}>
          <option value="">All topics</option>
          {tagOptions.map(([slug, name]) => (
            <option key={slug} value={slug}>
              {name}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="status">
          Status
        </label>
        <select
          id="status"
          value={query.status}
          onChange={(e) => update({ status: e.target.value as CatalogQuery["status"] })}
          className={selectClass}
        >
          <option value="">Any status</option>
          <option value="not-attempted">Not attempted</option>
          <option value="attempted">Attempted</option>
          <option value="solved">Solved</option>
        </select>
      </div>

      {catalog === "loading" && <p className="text-muted-foreground">Loading problems…</p>}
      {catalog === "error" && (
        <p role="alert">Couldn't load the problem list. It's rebuilt weekly; try again shortly.</p>
      )}

      {typeof catalog === "object" && (
        <>
          <div className="overflow-x-auto rounded-[10px] border">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="bg-subtle text-left text-xs text-muted-foreground">
                  <SortHeader label="#" sortKey="id" className="w-16" />
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Title
                  </th>
                  <SortHeader label="Difficulty" sortKey="difficulty" />
                  <SortHeader label="Acceptance" sortKey="ac" />
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Next review
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageOf(rows, page).map((p) => (
                  <tr key={p.slug} className="border-t">
                    <td className="px-4 py-3 font-mono text-[13px] text-muted-foreground">{p.id}</td>
                    <td className="px-4 py-3 font-medium">
                      <span className="inline-flex items-center gap-2">
                        <Link to={`/problems/${p.slug}`} className="hover:underline">
                          {p.title}
                        </Link>
                        {p.paid && (
                          <span className="text-muted-foreground">
                            <LockIcon />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <DifficultyBadge difficulty={p.difficulty} />
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-muted-foreground">{p.ac.toFixed(1)}%</td>
                    <td className={cn("px-4 py-3", statusOf(p.slug) === "not-attempted" && "text-muted-foreground")}>
                      {STATUS_LABEL[statusOf(p.slug)]}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-muted-foreground">
                      {bySlug.has(p.slug) ? shortDate(bySlug.get(p.slug)!.due) : "—"}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No problems match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <nav aria-label="Pages" className="flex items-center justify-end gap-2">
            <span className="mr-auto font-mono text-[13px] text-muted-foreground">
              page {page + 1} of {pages}
            </span>
            <Button variant="outline" size="sm" className="h-11" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            <Button variant="outline" size="sm" className="h-11" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}
