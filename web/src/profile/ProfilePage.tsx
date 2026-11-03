import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { Catalog, Difficulty } from "../../../api/src/catalog/types";
import { isLocalDate } from "../../../api/src/review/dates";
import { OUTCOMES, type HistoryAttempt, type Outcome } from "../../../api/src/review/types";
import { api } from "../api";
import { cn } from "../lib/utils";
import { localToday } from "../queue/rank";
import { shortDate } from "../queue/useSchedule";
import { byDay, calendar, streaks } from "./activity";
import { Calendar } from "./Calendar";
import { History } from "./History";
import { Journal } from "./Journal";
import { Sidebar } from "./Sidebar";
import { useLeetCodeProfile } from "./useLeetCodeProfile";
import { JOURNAL_SECTIONS, type HistoryFilter, type JournalSection } from "./search";

const pick = <T extends string>(v: string | null, allowed: readonly T[]): T | "" =>
  allowed.includes(v as T) ? (v as T) : "";
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const monthDay = (date: string) => shortDate(date).replace(/^\w+, /, "");

// Kept after the first load, so coming back is instant; refreshed in the background each time.
let cached: HistoryAttempt[] | undefined;

// The Profile page (#15, #60). Tab, filters, search and the chosen day live in the URL.
export function ProfilePage() {
  const [params, setParams] = useSearchParams();
  const [attempts, setAttempts] = useState<HistoryAttempt[] | "loading" | "error">(cached ?? "loading");
  const [topicNames, setTopicNames] = useState<Record<string, string>>({});
  const lc = useLeetCodeProfile();

  useEffect(() => {
    let live = true;
    api("/api/history")
      .then((res) => (res.ok ? (res.json() as Promise<{ attempts: HistoryAttempt[] }>) : Promise.reject(res.status)))
      .then((d) => live && setAttempts((cached = d.attempts)))
      .catch(() => live && !cached && setAttempts("error"));
    // Topic names for the filter; the catalog is usually already in the browser cache from Home.
    fetch("/data/catalog.json")
      .then((res) => (res.ok ? (res.json() as Promise<Catalog>) : null))
      .then((c) => live && c && setTopicNames(c.tags))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const update = (changes: Record<string, string>, replace = false) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace },
    );

  const tab = params.get("tab") === "journal" ? "journal" : "history";
  const day = isLocalDate(params.get("day")) ? params.get("day") : null;
  const filter: HistoryFilter = {
    q: params.get("q") ?? "",
    outcome: pick<Outcome>(params.get("outcome"), OUTCOMES),
    difficulty: pick<Difficulty>(params.get("d"), ["Easy", "Medium", "Hard"]),
    tag: params.get("tag") ?? "",
  };
  const section = pick(params.get("sec"), Object.keys(JOURNAL_SECTIONS) as JournalSection[]);

  const list = Array.isArray(attempts) ? attempts : [];
  const today = localToday();
  const derived = useMemo(() => {
    const grouped = byDay(list);
    const counts = new Map([...grouped].map(([d, as]) => [d, as.length]));
    const s = streaks(grouped.keys(), today);
    // An attempt is a review if you'd attempted the same problem before it.
    const reviews = new Set<HistoryAttempt>();
    const seen = new Set<string>();
    for (const a of [...list].reverse()) {
      if (seen.has(a.problemId)) reviews.add(a);
      seen.add(a.problemId);
    }
    const yearAgo = calendar(counts, today);
    const inYear = yearAgo.flatMap((w) => w.days).reduce((n, d) => n + d.count, 0);
    const tags = [...new Set(list.flatMap((a) => a.tags))];
    return { grouped, s, reviews, weeks: yearAgo, inYear, problems: seen.size, tags };
  }, [list, today]);

  const topics = derived.tags
    .map((t): [string, string] => [t, topicNames[t] ?? t])
    .sort((a, b) => a[1].localeCompare(b[1]));
  const { s } = derived;
  const tiles = [
    { label: "Current streak", value: days(s.current), note: "1+ attempt a day" },
    { label: "Longest streak", value: s.longest ? days(s.longest.days) : "0 days", note: s.longest ? `${monthDay(s.longest.from)} – ${monthDay(s.longest.to)}` : "none yet" },
    { label: "Active days", value: String(s.activeDays), note: s.first ? `since ${monthDay(s.first)}` : "none yet" },
    { label: "Attempts", value: String(list.length), note: `on ${derived.problems} problem${derived.problems === 1 ? "" : "s"}` },
  ];

  return (
    // Two columns on a wide screen (#61): your LeetCode profile and streaks on the left, the
    // calendar and tabs on the right. Stacked on a phone.
    <main className="mx-auto grid w-full max-w-[1120px] items-start gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[260px_minmax(0,1fr)]">
      <h1 className="sr-only">Profile</h1>
      <Sidebar lc={lc} first={s.first} tiles={tiles} />
      <div className="flex min-w-0 flex-col gap-5">
        {attempts === "loading" && <p className="text-muted-foreground">Loading…</p>}
        {attempts === "error" && <p role="alert">Couldn't load your history. Refresh to try again.</p>}
        {Array.isArray(attempts) && (
          <>
            <Calendar
              weeks={derived.weeks}
              total={derived.inYear}
              attemptsOn={(d) => derived.grouped.get(d) ?? []}
              selected={day}
              onSelect={(d) => update({ day: d ?? "" }, true)}
            />

            <div role="tablist" aria-label="Profile" className="flex gap-1 border-b">
              {(["history", "journal"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={tab === t}
                  onClick={() => update({ tab: t === "history" ? "" : t })}
                  className={cn(
                    "-mb-px h-11 border-b-2 px-3.5 font-medium",
                    tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "history" ? "History" : "Notes journal"}
                </button>
              ))}
            </div>

            {tab === "history" ? (
              <History
                attempts={attempts}
                isReview={(a) => derived.reviews.has(a)}
                topics={topics}
                filter={filter}
                onFilter={(f) =>
                  update(
                    { q: f.q ?? filter.q, outcome: f.outcome ?? filter.outcome, d: f.difficulty ?? filter.difficulty, tag: f.tag ?? filter.tag },
                    f.q !== undefined, // typing replaces the history entry instead of adding one per key
                  )
                }
              />
            ) : (
              <Journal
                attempts={attempts}
                query={params.get("jq") ?? ""}
                section={section}
                onChange={(c) =>
                  update({ jq: c.query ?? params.get("jq") ?? "", sec: c.section ?? section }, c.query !== undefined)
                }
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}
