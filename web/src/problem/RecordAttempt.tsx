import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Problem } from "../../../api/src/problems/types";
import { daysBetween } from "../../../api/src/review/dates";
import {
  FAILURE_MODES,
  MAX_MINUTES,
  type Attempt,
  type FailureMode,
  type NoteSection,
  type Outcome,
  type Schedule,
} from "../../../api/src/review/types";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import type { MockOaPrefill } from "../mockoa/prefill";
import { NoteEditor } from "../notes/NoteEditor";
import { prefillMinutes } from "../pending/group";
import { usePending } from "../pending/PendingContext";
import { localToday } from "../queue/rank";
import { shortDate } from "../queue/useSchedule";

const OUTCOME_LABEL: Record<Outcome, string> = { solved: "Solved", struggled: "Struggled", failed: "Failed" };
const fieldClass =
  "rounded-lg border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm";

// One form per problem (#57): recording by hand (#19), or grading what's synced and waiting.
export function RecordAttempt({
  problem,
  predictionAt,
  mockOa,
  onRecorded,
}: {
  problem: Problem;
  predictionAt: string | null;
  mockOa?: MockOaPrefill; // filled in from a finished mock OA (#62)
  onRecorded: (attempt: Attempt, schedule: Schedule) => void;
}) {
  const { groups, refresh } = usePending();
  const waiting = groups.find((g) => g.slug === problem.slug)?.submissions ?? [];
  const lastWaiting = waiting[waiting.length - 1];
  const [outcome, setOutcome] = useState<Outcome | undefined>(mockOa?.outcome);
  const [confidence, setConfidence] = useState<number>();
  const [minutes, setMinutes] = useState(mockOa ? String(mockOa.minutes) : "");
  const [minutesEdited, setMinutesEdited] = useState(!!mockOa);
  const prefilled = prefillMinutes(predictionAt, waiting);
  // A starting point you can change (#57); never overwrites what you typed.
  useEffect(() => {
    if (!minutesEdited) setMinutes(prefilled === null ? "" : String(prefilled));
  }, [prefilled, minutesEdited]);
  const [failureMode, setFailureMode] = useState<FailureMode | "">(mockOa?.failureMode ?? "");
  // The three note sections (#51).
  const [approach, setApproach] = useState("");
  const [learned, setLearned] = useState("");
  const [reflection, setReflection] = useState("");
  const [uploads, setUploads] = useState<Record<NoteSection, number>>({ approach: 0, learned: 0, reflection: 0 });
  const tracker = (section: NoteSection) => (n: number) => setUploads((u) => (u[section] === n ? u : { ...u, [section]: n }));
  // Stable per section, so each editor reports its uploads without re-rendering in a loop.
  const onApproachUploads = useCallback(tracker("approach"), []);
  const onLearnedUploads = useCallback(tracker("learned"), []);
  const onReflectionUploads = useCallback(tracker("reflection"), []);
  const uploading = uploads.approach + uploads.learned + uploads.reflection;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; due: string } | { ok: false; error: string }>();

  const mins = Number(minutes);
  const needsFailure = outcome === "struggled" || outcome === "failed"; // #50
  const ready =
    outcome && confidence && Number.isInteger(mins) && mins >= 1 && mins <= MAX_MINUTES && (!needsFailure || failureMode);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || uploading > 0) return;
    setBusy(true);
    setResult(undefined);
    try {
      const res = await api("/api/attempts", {
        method: "POST",
        body: JSON.stringify({
          problemId: problem.id,
          slug: problem.slug,
          title: problem.title,
          difficulty: problem.difficulty,
          tags: problem.tags.map((t) => t.slug),
          outcome,
          confidence,
          minutes: mins,
          failureMode: failureMode || null,
          approach,
          learned,
          reflection,
          // Synced attempts count from the day you solved, not the day you grade (#57).
          localDate: localToday(lastWaiting ? new Date(lastWaiting.timestamp * 1000) : undefined),
          ...(mockOa && { mockOa: { sessionId: mockOa.sessionId, index: mockOa.index } }),
        }),
      });
      const body = await res.json();
      if (!res.ok) return setResult({ ok: false, error: body.error ?? "Couldn't save the attempt." });
      setResult({ ok: true, due: (body.schedule as Schedule).due });
      setOutcome(undefined);
      setConfidence(undefined);
      setMinutes("");
      setMinutesEdited(false);
      setFailureMode("");
      setApproach("");
      setLearned("");
      setReflection("");
      onRecorded(body.attempt as Attempt, body.schedule as Schedule);
      void refresh();
    } catch {
      setResult({ ok: false, error: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-labelledby="record-h" className="flex flex-col gap-5 rounded-[10px] border p-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <h2 id="record-h" className="text-base font-semibold">
          {waiting.length ? "Grade this attempt" : "Record attempt"}
        </h2>
        {waiting.length > 1 && <span className="text-[13px] text-muted-foreground">{waiting.length} submissions become one grade</span>}
        {mockOa && <span className="text-[13px] text-muted-foreground">Filled in from your {mockOa.summary}. Change anything.</span>}
      </div>

      {waiting.length > 0 && (
        <ul className="divide-y rounded-[10px] border">
          {waiting.map((s) => (
            <li key={s.id} className="px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[13px] text-muted-foreground">
                  {new Date(s.timestamp * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
                <span className="font-medium">{s.status}</span>
                <span className="text-[13px] text-muted-foreground">{[s.lang, s.accepted ? s.runtime : null].filter(Boolean).join(" · ")}</span>
              </div>
              {/* Only what the extension synced has code; the backup poll doesn't (#57). */}
              {s.code && (
                <details className="mt-1">
                  <summary className="flex min-h-11 cursor-pointer items-center text-[13px] text-muted-foreground">View code</summary>
                  <pre className="overflow-x-auto rounded-lg border bg-subtle p-3 font-mono text-[13px] leading-normal">{s.code}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <Choices label="How did it go?">
        {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
          <Button key={o} type="button" variant={outcome === o ? "default" : "outline"} aria-pressed={outcome === o} onClick={() => setOutcome(o)}>
            {OUTCOME_LABEL[o]}
          </Button>
        ))}
      </Choices>

      <Choices label="Confidence you could do it again" hint="1 = shaky, 5 = could redo it cold">
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            type="button"
            size="icon"
            variant={confidence === n ? "default" : "outline"}
            aria-pressed={confidence === n}
            onClick={() => setConfidence(n)}
          >
            {n}
          </Button>
        ))}
      </Choices>

      <div className="flex flex-col gap-2">
        <Label htmlFor="minutes">Minutes spent</Label>
        <Input
          id="minutes"
          inputMode="numeric"
          value={minutes}
          onChange={(e) => {
            setMinutesEdited(true);
            setMinutes(e.target.value.replace(/\D/g, ""));
          }}
          className="w-28 text-base sm:text-sm"
        />
        {prefilled !== null && !minutesEdited && predictionAt && (
          <span className="text-[13px] text-muted-foreground">
            From your prediction at {new Date(predictionAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} to your last
            submission. Change it if you took a break.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="failure">
          What went wrong? {needsFailure ? "" : <span className="font-normal text-muted-foreground">(optional)</span>}
        </Label>
        <select
          id="failure"
          value={failureMode}
          onChange={(e) => setFailureMode(e.target.value as FailureMode | "")}
          className={`${fieldClass} h-11 max-w-full`}
        >
          <option value="">{needsFailure ? "Choose one" : "Nothing in particular"}</option>
          {(Object.keys(FAILURE_MODES) as FailureMode[]).map((m) => (
            <option key={m} value={m}>
              {FAILURE_MODES[m]}
            </option>
          ))}
        </select>
      </div>

      <NoteEditor id="approach" label="Approach" hint="what you did" value={approach} setValue={setApproach} onUploadingChange={onApproachUploads} />
      <NoteEditor id="learned" label="What I learned" hint="about the problem or pattern" value={learned} setValue={setLearned} onUploadingChange={onLearnedUploads} />
      <NoteEditor id="reflection" label="Reflection" hint="about you and your process" value={reflection} setValue={setReflection} onUploadingChange={onReflectionUploads} />

      <div className="flex flex-wrap items-center gap-3">
        {/* Saving mid-upload would store a note pointing at an image that isn't there yet (#53). */}
        <Button type="submit" disabled={!ready || busy || uploading > 0}>
          {busy ? "Saving…" : uploading > 0 ? "Save attempt (waiting for upload)" : waiting.length ? "Save grade" : "Save attempt"}
        </Button>
        {result?.ok === true && (
          <p role="status">
            Saved. Next review {shortDate(result.due)}
            {daysBetween(localToday(), result.due) > 0
              ? ` (in ${daysBetween(localToday(), result.due)} day${daysBetween(localToday(), result.due) === 1 ? "" : "s"}).`
              : " (due now)."}
          </p>
        )}
        {result?.ok === false && <p role="alert">{result.error}</p>}
      </div>
    </form>
  );
}

function Choices({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">
        {label}
        {hint && <span className="ml-2 font-normal text-muted-foreground">{hint}</span>}
      </legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}
