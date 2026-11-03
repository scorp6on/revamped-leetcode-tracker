import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { HistoryAttempt } from "../../../api/src/review/types";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { Markdown } from "../notes/Markdown";
import { shortDate } from "../queue/useSchedule";
import { OUTCOME_LABEL } from "./Calendar";
import { JOURNAL_SECTIONS, journalEntries, searchJournal, words, type JournalSection } from "./search";

const PAGE = 25;

// Wraps each searched word in <mark> inside the rendered note. The Markdown is remounted when the
// words change (see its key), so old marks never linger.
function Highlighted({ text, ws }: { text: string; ws: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current || !ws.length) return;
    const pattern = new RegExp(`(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    const walker = document.createTreeWalker(box.current, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const parts = node.data.split(pattern);
      if (parts.length < 2) continue;
      const frag = document.createDocumentFragment();
      parts.forEach((p, i) => {
        if (i % 2) {
          const mark = document.createElement("mark");
          mark.className = "rounded-sm bg-muted-foreground/25 text-foreground";
          mark.textContent = p;
          frag.append(mark);
        } else if (p) frag.append(p);
      });
      node.replaceWith(frag);
    }
  }, [ws]);
  return (
    <div ref={box}>
      <Markdown key={ws.join(" ")} text={text} />
    </div>
  );
}

// Everything you've written, newest first (#15, #60): your own notes only.
export function Journal({
  attempts,
  query,
  section,
  onChange,
}: {
  attempts: HistoryAttempt[];
  query: string;
  section: JournalSection | "";
  onChange: (c: { query?: string; section?: JournalSection | "" }) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const entries = useMemo(() => journalEntries(attempts), [attempts]);
  const ws = useMemo(() => words(query), [query]);
  const list = searchJournal(entries, query, section);
  // Older attempts' single Notes box only gets a chip if any exist.
  const chips = (Object.keys(JOURNAL_SECTIONS) as JournalSection[]).filter(
    (s) => s !== "notes" || entries.some((e) => e.section === "notes"),
  );
  const change = (c: { query?: string; section?: JournalSection | "" }) => {
    setShown(PAGE);
    onChange(c);
  };

  return (
    <section aria-label="Notes journal" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Search your notes"
          placeholder="Search your notes"
          value={query}
          onChange={(e) => change({ query: e.target.value })}
          className="h-11 min-w-0 flex-[1_1_200px]"
        />
        {(["", ...chips] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            aria-pressed={section === s}
            onClick={() => change({ section: s })}
            className={cn(
              "h-11 rounded-full border px-3.5 text-[13px] font-medium",
              section === s ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s ? JOURNAL_SECTIONS[s] : "All sections"}
          </button>
        ))}
      </div>
      <p className="text-[13px] text-muted-foreground">
        {query.trim() ? `${list.length} note${list.length === 1 ? "" : "s"} match "${query.trim()}"` : `${list.length} notes`} · newest first
      </p>
      {list.length === 0 && (
        <p className="rounded-[10px] border border-dashed px-4 py-6 text-center text-muted-foreground">
          {entries.length ? "No notes match." : "No notes yet. What you write when recording an attempt collects here."}
        </p>
      )}
      {list.slice(0, shown).map((e) => (
        <article key={`${e.attempt.createdAt}-${e.section}`} className="flex flex-col gap-2 rounded-[10px] border px-5 py-4">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <Link to={`/problems/${e.attempt.slug}`} className="font-semibold hover:underline">
              {e.attempt.problemId}. {e.attempt.title}
            </Link>
            <span className="text-[13px] text-muted-foreground">
              {shortDate(e.attempt.localDate)} · {OUTCOME_LABEL[e.attempt.outcome]}
            </span>
          </div>
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{JOURNAL_SECTIONS[e.section]}</span>
          <Highlighted text={e.text} ws={ws} />
        </article>
      ))}
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
