import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Catalog, CatalogEntry, Difficulty } from "../../../api/src/catalog/types";
import type { ListEntry, PastSession, ProblemSource } from "../../../api/src/mockoa/types";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { localToday } from "../queue/rank";
import { shortDate } from "../queue/useSchedule";
import { clampCount, clampMinutes, pct, stepMinutes } from "./helpers";

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

function Stepper({
  label,
  value,
  unit,
  note,
  onStep,
  onType,
}: {
  label: string;
  value: number;
  unit?: string;
  note: string;
  onStep: (dir: 1 | -1) => void;
  onType: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const id = `stepper-${label}`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <div className="flex w-fit items-center overflow-hidden rounded-lg border">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} onClick={() => onStep(-1)} className="flex size-11 items-center justify-center border-r text-lg text-muted-foreground hover:text-foreground">
          −
        </button>
        <span className="flex h-11 items-center gap-1 px-2">
          <input
            id={id}
            inputMode="numeric"
            value={text}
            onChange={(e) => setText(e.target.value.replace(/\D/g, ""))}
            onBlur={() => onType(Number(text))}
            onKeyDown={(e) => e.key === "Enter" && onType(Number(text))}
            className="w-12 bg-transparent text-center text-base font-semibold tabular-nums outline-none sm:text-sm"
          />
          {unit && <span className="text-muted-foreground">{unit}</span>}
        </span>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => onStep(1)} className="flex size-11 items-center justify-center border-l text-lg text-muted-foreground hover:text-foreground">
          +
        </button>
      </div>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

// The Mock OA setup page (#14, #62): count, time, where problems come from, and past tests.
export function SetupPage() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [past, setPast] = useState<PastSession[] | null>(null);
  const [list, setList] = useState<ListEntry[]>([]);
  const [count, setCount] = useState(3);
  const [minutes, setMinutes] = useState(90);
  const [source, setSource] = useState<ProblemSource>("catalog");
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [unsolvedOnly, setUnsolvedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; skipped?: { slug: string; reason: string }[] } | null>(null);

  useEffect(() => {
    let live = true;
    api("/api/mockoa")
      .then((res) => (res.ok ? (res.json() as Promise<{ past: PastSession[]; list: ListEntry[] }>) : Promise.reject()))
      .then((d) => {
        if (!live) return;
        setPast(d.past);
        setList(d.list);
        if (d.list.length) setSource("list");
      })
      .catch(() => live && setPast([]));
    fetch("/data/catalog.json")
      .then((res) => (res.ok ? (res.json() as Promise<Catalog>) : null))
      .then((c) => live && c && setCatalog(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const bySlug = useMemo(() => new Map((catalog?.problems ?? []).map((p) => [p.slug, p])), [catalog]);
  const listed = list.map((e) => bySlug.get(e.slug)).filter((p): p is CatalogEntry => !!p);
  const matches = useMemo(() => {
    const ws = words(search);
    if (!ws.length || !catalog) return [];
    const inList = new Set(list.map((e) => e.slug));
    return catalog.problems
      .filter((p) => !inList.has(p.slug) && ws.every((w) => p.id === w || p.title.toLowerCase().includes(w)))
      .slice(0, 8);
  }, [search, catalog, list]);
  const pool = useMemo(() => {
    if (!catalog) return null;
    return catalog.problems.filter(
      (p) => !p.paid && (!difficulties.length || difficulties.includes(p.difficulty)) && (!tags.length || p.tags.some((t) => tags.includes(t))),
    ).length;
  }, [catalog, difficulties, tags]);
  const topics = useMemo(
    () => Object.entries(catalog?.tags ?? {}).sort((a, b) => a[1].localeCompare(b[1])),
    [catalog],
  );

  const saveList = (next: ListEntry[]) => {
    setList(next);
    void api("/api/mockoa/list", { method: "PUT", body: JSON.stringify({ problems: next }) }).catch(() => {});
  };

  const usable = source === "list" ? listed.filter((p) => !p.paid).length : (pool ?? 0);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/mockoa", {
        method: "POST",
        body: JSON.stringify({ count, minutes, source, difficulties: source === "catalog" ? difficulties : [], tags: source === "catalog" ? tags : [], unsolvedOnly }),
      });
      const body = await res.json();
      if (!res.ok) return setError({ text: body.error ?? "Couldn't start the mock OA.", skipped: body.skipped });
      navigate(`/mock-oa/${body.id}`);
    } catch {
      setError({ text: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((v) => v !== x) : [...xs, x]);
  const chip = (on: boolean) =>
    cn("h-10 rounded-lg border px-3.5 font-medium", on ? "border-foreground bg-foreground text-background" : "hover:bg-subtle");

  return (
    <main className="mx-auto grid w-full max-w-[1120px] items-start gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Mock OA</h1>
          <p className="mt-1.5 max-w-[560px] text-muted-foreground">
            A timed practice test in the shape of a real online assessment. You code in Python here, and the app runs your code
            against tests. Titles, topics and difficulty stay hidden until you finish, so you have to spot the pattern yourself.
          </p>
        </div>

        <section aria-labelledby="new-h" className="flex flex-col gap-5 rounded-[10px] border p-5">
          <h2 id="new-h" className="text-base font-semibold">
            New mock OA
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Stepper label="Problems" value={count} note="Any number from 1 to 10." onStep={(d) => setCount(clampCount(count + d))} onType={(n) => setCount(clampCount(n))} />
            <Stepper
              label="Time"
              value={minutes}
              unit="min"
              note="For the whole test. Steps of 5, or type any number."
              onStep={(d) => setMinutes(stepMinutes(minutes, d))}
              onType={(n) => setMinutes(clampMinutes(n))}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-medium">Pick problems from</span>
            <div role="radiogroup" aria-label="Pick problems from" className="flex w-fit overflow-hidden rounded-[10px] border">
              {(["catalog", "list"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={source === s}
                  onClick={() => setSource(s)}
                  className={cn("h-10 px-4 font-medium", source === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                >
                  {s === "catalog" ? "Random from the catalog" : "My list"}
                </button>
              ))}
            </div>
          </div>

          {source === "list" ? (
            <div className="flex flex-col gap-2.5 rounded-[10px] border bg-subtle p-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong className="font-semibold">Your list · {listed.length} problem{listed.length === 1 ? "" : "s"}</strong>
                <span className="text-[13px] text-muted-foreground">
                  {Math.min(count, listed.length)} of these will be picked at random
                </span>
              </div>
              <div className="relative">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Add a problem by number or title…"
                  aria-label="Add a problem by number or title"
                  className="h-11 w-full rounded-lg border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
                />
                {matches.length > 0 && (
                  <ul className="absolute inset-x-0 top-12 z-10 max-h-80 overflow-auto rounded-lg border bg-background shadow-md">
                    {matches.map((p) => (
                      <li key={p.slug}>
                        <button
                          type="button"
                          disabled={p.paid}
                          onClick={() => {
                            saveList([...list, { id: p.id, slug: p.slug }]);
                            setSearch("");
                          }}
                          className="flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-subtle disabled:opacity-50"
                        >
                          <span className="font-mono text-muted-foreground">{p.id}.</span>
                          <span className="min-w-0 flex-1 truncate">{p.title}</span>
                          {p.paid && <span className="text-xs text-muted-foreground">Premium</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {listed.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {listed.map((p) => (
                    <li key={p.slug} className="flex h-8 items-center gap-1.5 rounded-full border bg-background pr-0.5 pl-2.5 text-[13px]">
                      <span className="font-mono text-muted-foreground">{p.id}</span>
                      <span className="max-w-[220px] truncate">{p.title}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${p.title}`}
                        onClick={() => saveList(list.filter((e) => e.slug !== p.slug))}
                        className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-subtle hover:text-foreground"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <span className="text-xs text-muted-foreground">
                Saved for next time. You see the titles here because you chose them, but not which ones were picked or in what
                order until you finish.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5 rounded-[10px] border bg-subtle p-3.5">
              <div className="flex flex-col gap-2">
                <span className="font-medium">Difficulty</span>
                <div className="flex flex-wrap gap-2">
                  {DIFFICULTIES.map((d) => (
                    <button key={d} type="button" aria-pressed={difficulties.includes(d)} onClick={() => setDifficulties(toggle(difficulties, d))} className={chip(difficulties.includes(d))}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="topic-pick" className="font-medium">
                  Topics
                </label>
                <select
                  id="topic-pick"
                  value=""
                  onChange={(e) => e.target.value && setTags(toggle(tags, e.target.value))}
                  className="h-11 rounded-lg border bg-background px-3 text-base sm:text-sm"
                >
                  <option value="">{tags.length ? "Add another topic…" : "Any topic"}</option>
                  {topics.filter(([slug]) => !tags.includes(slug)).map(([slug, name]) => (
                    <option key={slug} value={slug}>
                      {name}
                    </option>
                  ))}
                </select>
                {tags.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <li key={t} className="flex h-8 items-center gap-1 rounded-full border bg-background pr-0.5 pl-2.5 text-[13px]">
                        {catalog?.tags[t] ?? t}
                        <button type="button" aria-label={`Remove ${catalog?.tags[t] ?? t}`} onClick={() => setTags(tags.filter((x) => x !== t))} className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-subtle">
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <span className="text-xs text-muted-foreground">Narrows which problems can be picked. The tags still aren't shown during the test.</span>
              </div>
              <label className="flex min-h-11 items-center gap-2.5">
                <input type="checkbox" checked={unsolvedOnly} onChange={(e) => setUnsolvedOnly(e.target.checked)} className="size-[18px]" />
                <span>
                  Unsolved only <span className="text-muted-foreground">· off means problems you've attempted can come up too</span>
                </span>
              </label>
              {pool !== null && <span className="text-xs text-muted-foreground">{pool.toLocaleString()} problems match. Premium problems are skipped.</span>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3.5 border-t pt-4">
            <Button type="button" className="h-11 px-5" disabled={busy || usable < count} onClick={start}>
              {busy ? "Picking problems…" : `Start · ${count} problem${count === 1 ? "" : "s"} · ${minutes} min`}
            </Button>
            <span className="text-[13px] text-muted-foreground">
              {usable < count
                ? source === "list"
                  ? `Add ${count - usable} more to your list, or ask for fewer.`
                  : "Not enough problems match these filters."
                : "New problems get AI-written tests first: about 20 s each, under 1¢."}
            </span>
          </div>
          {error && (
            <div role="alert" className="flex flex-col gap-1 rounded-lg border p-3">
              <span>{error.text}</span>
              {error.skipped?.length ? (
                <ul className="text-[13px] text-muted-foreground">
                  {error.skipped.map((s) => (
                    <li key={s.slug}>
                      {bySlug.get(s.slug)?.title ?? s.slug}: {s.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <aside aria-labelledby="past-h" className="flex flex-col gap-3">
        <h2 id="past-h" className="text-base font-semibold">
          Past mock OAs
        </h2>
        {past === null && <p className="text-muted-foreground">Loading…</p>}
        {past?.length === 0 && <p className="text-muted-foreground">None yet. Your first one shows up here.</p>}
        {past?.map((p) => (
          <Link key={p.id} to={`/mock-oa/${p.id}`} className="flex flex-col gap-1 rounded-[10px] border px-3.5 py-3 hover:bg-subtle">
            <div className="flex justify-between gap-2">
              <strong className="font-semibold">{shortDate(localToday(new Date(p.createdAt)))}</strong>
              <span className="font-semibold tabular-nums">
                {p.summary ? `${pct(p.summary.testsPassed, p.summary.testsTotal)}%` : "In progress"}
              </span>
            </div>
            <span className="text-[13px] text-muted-foreground">
              {p.summary
                ? `${p.summary.passedProblems} of ${p.count} passed · ${p.summary.usedMinutes} of ${p.minutes} min · ${p.source === "list" ? "my list" : "catalog"}`
                : `${p.count} problems · ${p.minutes} min · resume`}
            </span>
          </Link>
        ))}
        <span className="text-xs text-muted-foreground">Score = the share of all tests you passed. A problem counts as passed at 80%.</span>
      </aside>
    </main>
  );
}
