import { FAILURE_MODES, NOTE_SECTIONS, type Attempt, type NoteSection } from "../../../api/src/review/types";
import { Markdown } from "../notes/Markdown";

const OUTCOME_LABEL = { solved: "Solved", struggled: "Struggled", failed: "Failed" } as const;

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

const summary = (a: Attempt) =>
  [OUTCOME_LABEL[a.outcome], `confidence ${a.confidence}`, `${a.minutes} min`, a.failureMode && FAILURE_MODES[a.failureMode]]
    .filter(Boolean)
    .join(" · ");

// Your attempts on this problem, newest first (#53): an early slice of the Profile timeline (M10).
export function PastAttempts({ attempts }: { attempts: Attempt[] }) {
  if (!attempts.length) return null;
  return (
    <details className="group rounded-[10px] border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-5 py-2 text-base font-semibold">
        <span aria-hidden="true" className="text-[11px] text-muted-foreground transition-transform group-open:rotate-90">
          ▶
        </span>
        Past attempts
        <span className="font-mono text-[13px] font-normal text-muted-foreground">{attempts.length}</span>
      </summary>
      <div className="divide-y border-t">
        {attempts.map((a, i) => (
          // The newest starts open; the rest show their summary line until opened.
          <details key={a.createdAt} open={i === 0} className="group/item">
            <summary className="flex min-h-[52px] cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
              <span className="font-medium">{dateOf(a.createdAt)}</span>
              <span className="text-[13px] text-muted-foreground">{summary(a)}</span>
              <span className="ml-auto text-[13px] text-muted-foreground group-open/item:hidden">Show notes</span>
            </summary>
            <div className="flex flex-col gap-3 px-5 pb-4">
              {a.prediction && <Section title="Prediction" text={a.prediction} />}
              {(Object.keys(NOTE_SECTIONS) as NoteSection[]).map(
                (s) => a[s]?.trim() && <Section key={s} title={NOTE_SECTIONS[s]} text={a[s]} />,
              )}
              {/* Attempts recorded before rich notes had one box. */}
              {a.notes?.trim() && <Section title="Notes" text={a.notes} />}
              {!a.prediction && !a.notes?.trim() && !(Object.keys(NOTE_SECTIONS) as NoteSection[]).some((s) => a[s]?.trim()) && (
                <p className="text-muted-foreground">No notes.</p>
              )}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</span>
      <Markdown text={text} />
    </div>
  );
}
