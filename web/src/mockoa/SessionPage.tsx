import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { MAX_PREDICTION_LENGTH } from "../../../api/src/problems/types";
import type { RunReport, SessionView } from "../../../api/src/mockoa/types";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { Editor } from "./Editor";
import { clock, clockOffset, draftOf, dropDrafts, keepDraft, passes } from "./helpers";
import { Report } from "./Report";
import { Results } from "./Results";

const SAVE_EVERY_MS = 5000;

// /mock-oa/:id: the test while the clock runs, then its results (#14, #62).
export function SessionPage() {
  const { id = "" } = useParams();
  const [session, setSession] = useState<SessionView | "loading" | "missing" | "error">("loading");

  useEffect(() => {
    let live = true;
    api(`/api/mockoa/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) return setSession("missing");
        if (!res.ok) return setSession("error");
        setSession(((await res.json()) as { session: SessionView }).session);
      })
      .catch(() => live && setSession("error"));
    return () => {
      live = false;
    };
  }, [id]);

  if (session === "loading") return <p className="mx-auto w-full max-w-[1120px] px-6 py-10 text-muted-foreground">Loading…</p>;
  if (session === "missing" || session === "error") {
    return (
      <p role="alert" className="mx-auto w-full max-w-[1120px] px-6 py-10">
        {session === "missing" ? "There's no such mock OA." : "Couldn't load the mock OA. Refresh to try again."}{" "}
        <Link to="/mock-oa" className="underline">
          Back to Mock OA
        </Link>
      </p>
    );
  }
  if (session.finishedAt) return <Results session={session} />;
  return <Running initial={session} onFinished={setSession} />;
}

function Running({ initial, onFinished }: { initial: SessionView; onFinished: (s: SessionView) => void }) {
  const { id } = initial;
  const [params, setParams] = useSearchParams();
  const index = Math.min(initial.problems.length - 1, Math.max(0, Number(params.get("p") ?? 1) - 1 || 0));
  const [pane, setPane] = useState<"problem" | "code">("problem"); // phones show one at a time
  // Your code: this browser's copy wins, since it's saved on every keystroke (#62 A).
  const [codes, setCodes] = useState(() => initial.problems.map((p, i) => draftOf(id, i) ?? p.code));
  const [approaches, setApproaches] = useState(() => initial.problems.map((p) => p.approach));
  const [reports, setReports] = useState<(RunReport | null)[]>(() => initial.problems.map((p) => p.last));
  const [best, setBest] = useState(() => initial.problems.map((p) => p.best));
  const [running, setRunning] = useState<"run" | "submit" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const navigate = useNavigate();

  // Started by accident: deleted, never counts anywhere (#62).
  const cancel = async () => {
    if (!window.confirm("Cancel this test? It's deleted, with your code and approaches, and won't count anywhere.")) return;
    setFinishing(true);
    try {
      const res = await api(`/api/mockoa/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't cancel it.");
      dropDrafts(id, initial.problems.length);
      navigate("/mock-oa", { replace: true });
    } catch (err) {
      setFinishing(false);
      setNotice((err as Error).message === "Failed to fetch" ? "Couldn't reach the server. Try again." : (err as Error).message);
    }
  };

  // The clock, corrected by the server's time so a wrong device clock can't change it.
  const offset = useMemo(() => clockOffset(initial.now, Date.now()), [initial.now]);
  const deadline = Date.parse(initial.deadline);
  const [left, setLeft] = useState(() => deadline - (Date.now() + offset));

  // Time on each problem: counted while it's open and the page is visible.
  const active = useRef(initial.problems.map((p) => p.activeMs));
  const saved = useRef(initial.problems.map((p) => ({ code: p.code, activeMs: p.activeMs })));
  const codesRef = useRef(codes);
  codesRef.current = codes;

  const finish = useCallback(async () => {
    setFinishing(true);
    try {
      const res = await api(`/api/mockoa/${id}/finish`, { method: "POST", body: JSON.stringify({ codes: codesRef.current }) });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { session: SessionView };
      dropDrafts(id, initial.problems.length);
      onFinished(body.session);
    } catch {
      setFinishing(false);
      setNotice("Couldn't finish: check your connection. Your code is kept in this browser; try again.");
    }
  }, [id, initial.problems.length, onFinished]);

  useEffect(() => {
    const tick = setInterval(() => {
      const remaining = deadline - (Date.now() + offset);
      setLeft(remaining);
      if (document.visibilityState === "visible") active.current[index] += 1000;
    }, 1000);
    return () => clearInterval(tick);
  }, [deadline, offset, index]);

  // Time's up: everything is submitted as it stands (#62).
  // Tried once by itself; if that fails, the Finish button tries again.
  const ended = left <= 0;
  const autoFinished = useRef(false);
  useEffect(() => {
    if (!ended || autoFinished.current) return;
    autoFinished.current = true;
    void finish();
  }, [ended, finish]);

  // Autosave every few seconds, only what changed.
  useEffect(() => {
    const save = setInterval(() => {
      codesRef.current.forEach((code, i) => {
        const was = saved.current[i];
        const activeMs = active.current[i];
        if (code === was.code && activeMs - was.activeMs < 30_000) return;
        saved.current[i] = { code, activeMs };
        void api(`/api/mockoa/${id}/problems/${i}`, { method: "PUT", body: JSON.stringify({ code, activeMs }) }).catch(() => {
          saved.current[i] = was; // try again next time
        });
      });
    }, SAVE_EVERY_MS);
    return () => clearInterval(save);
  }, [id]);

  const setCode = (code: string) => {
    keepDraft(id, index, code);
    setCodes((cs) => cs.map((c, i) => (i === index ? code : c)));
  };

  const run = async (submit: boolean) => {
    setRunning(submit ? "submit" : "run");
    setNotice(null);
    try {
      const res = await api(`/api/mockoa/${id}/problems/${index}/run`, { method: "POST", body: JSON.stringify({ code: codes[index], submit }) });
      const body = await res.json();
      if (res.status === 409) return void finish();
      if (!res.ok) return setNotice(body.error ?? "Couldn't run your code.");
      setReports((rs) => rs.map((r, i) => (i === index ? body.report : r)));
      setBest((bs) => bs.map((b, i) => (i === index ? body.best : b)));
      saved.current[index] = { ...saved.current[index], code: codes[index] };
    } catch {
      setNotice("Couldn't reach the server. Your code is kept in this browser; try again.");
    } finally {
      setRunning(null);
    }
  };

  const pick = (i: number) => setParams((p) => ({ ...Object.fromEntries(p), p: String(i + 1) }), { replace: true });
  const problem = initial.problems[index];
  const statement = useMemo(() => DOMPurify.sanitize(problem.statement), [problem.statement]);
  const locked = !!approaches[index];

  return (
    <div className="flex flex-1 flex-col">
      {/* The session bar: problems, the clock, Finish. */}
      <div className="sticky top-0 z-20 border-b bg-background">
        <div className="mx-auto flex min-h-15 max-w-[1400px] flex-wrap items-center gap-3 px-4 py-2 sm:px-5">
          <span className="font-semibold">Mock OA</span>
          <div role="tablist" aria-label="Problems" className="flex flex-wrap gap-1.5">
            {initial.problems.map((p, i) => (
              <button
                key={i}
                role="tab"
                type="button"
                aria-selected={i === index}
                onClick={() => pick(i)}
                className={cn(
                  "flex h-9 min-w-11 items-center justify-center rounded-lg border px-3 font-medium",
                  i === index ? "border-foreground bg-foreground text-background" : passes(best[i]) ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {i + 1}
                {passes(best[i]) && " ✓"}
              </button>
            ))}
          </div>
          <span role="timer" aria-label="Time left" className={cn("ml-auto font-mono text-lg font-medium tabular-nums", left < 5 * 60_000 && "underline decoration-2 underline-offset-4")}>
            {clock(left)}
          </span>
          <Button variant="ghost" className="h-10 text-muted-foreground" disabled={finishing} onClick={cancel}>
            Cancel test
          </Button>
          <Button
            variant="outline"
            className="h-10"
            disabled={finishing}
            onClick={() => {
              if (window.confirm("Finish now? Any code you changed since your last Submit is submitted.")) void finish();
            }}
          >
            {finishing ? "Finishing…" : "Finish"}
          </Button>
        </div>
      </div>

      {/* Phones: one pane at a time. */}
      <div className="mx-4 mt-3 flex overflow-hidden rounded-[10px] border lg:hidden">
        {(["problem", "code"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={pane === v}
            onClick={() => setPane(v)}
            className={cn("h-10 flex-1 font-medium", pane === v ? "bg-foreground text-background" : "text-muted-foreground")}
          >
            {v === "problem" ? "Problem" : "Code"}
          </button>
        ))}
      </div>

      <main className="mx-auto grid w-full max-w-[1400px] flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section aria-label="Problem" className={cn("flex min-w-0 flex-col gap-3 px-4 py-5 sm:px-6 lg:border-r", pane !== "problem" && "hidden lg:flex")}>
          <h1 className="text-xl font-semibold">Problem {index + 1}</h1>
          <span className="text-xs text-muted-foreground">Title, number, topics and difficulty are hidden until you finish.</span>
          <div className="statement" dangerouslySetInnerHTML={{ __html: statement }} />
        </section>

        <section aria-label="Code" className={cn("flex min-w-0 flex-col gap-2.5 px-4 py-4 sm:px-5", pane !== "code" && "hidden lg:flex")}>
          {locked ? (
            <div className="flex flex-col gap-0.5 rounded-[10px] border px-3 py-2.5">
              <span className="text-xs text-muted-foreground">Your approach · locked</span>
              <span className="font-medium">{approaches[index]}</span>
            </div>
          ) : (
            <ApproachLock
              key={index}
              onLock={async (text) => {
                const res = await api(`/api/mockoa/${id}/problems/${index}/approach`, { method: "POST", body: JSON.stringify({ text }) });
                if (res.status === 409 && ended) return void finish();
                if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't lock it.");
                setApproaches((as) => as.map((a, i) => (i === index ? text : a)));
              }}
            />
          )}

          <div className={cn("flex flex-col overflow-hidden rounded-[10px] border", !locked && "opacity-60")}>
            <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
              <span>Python 3 · the function is called {problem.stub.includes("class Design") ? "Design" : "solve"} so its name gives nothing away</span>
              {!locked && <span>Lock your approach to start coding</span>}
            </div>
            <Editor key={`${index}-${locked}`} label={`Code for problem ${index + 1}`} value={codes[index]} onChange={setCode} readOnly={!locked} />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="h-11" disabled={!locked || !!running || finishing} onClick={() => run(false)}>
              {running === "run" ? "Running…" : "Run examples"}
            </Button>
            <Button className="h-11" disabled={!locked || !!running || finishing} onClick={() => run(true)}>
              {running === "submit" ? "Submitting…" : "Submit"}
            </Button>
          </div>
          {notice && (
            <p role="alert" className="text-[13px]">
              {notice}
            </p>
          )}
          {reports[index] && <Report key={reports[index]!.at} report={reports[index]!} />}
        </section>
      </main>
    </div>
  );
}

// Predict the pattern before coding (#14); it can't be changed once locked.
function ApproachLock({ onLock }: { onLock: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2 rounded-[10px] border p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await onLock(text.trim());
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="approach" className="font-medium">
        Your approach, before you code
      </label>
      <textarea
        id="approach"
        value={text}
        maxLength={MAX_PREDICTION_LENGTH}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="e.g. sliding window, track the most frequent letter"
        className="rounded-lg border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" className="h-11" disabled={busy || !text.trim()}>
          {busy ? "Locking…" : "Lock approach"}
        </Button>
        <span className="text-xs text-muted-foreground">Saved as your prediction, so the AI review grades it after you record.</span>
      </div>
      {error && (
        <p role="alert" className="text-[13px]">
          {error}
        </p>
      )}
    </form>
  );
}
