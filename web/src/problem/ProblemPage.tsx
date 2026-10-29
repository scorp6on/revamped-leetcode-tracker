import DOMPurify from "dompurify";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { MAX_PREDICTION_LENGTH, type Prediction, type Problem } from "../../../api/src/problems/types";
import { api } from "../api";
import { DifficultyBadge } from "../components/DifficultyBadge";
import { Button, buttonVariants } from "../components/ui/button";
import { Label } from "../components/ui/label";
import type { Attempt } from "../../../api/src/review/types";
import { PastAttempts } from "./PastAttempts";
import { RecordAttempt } from "./RecordAttempt";

type Load = "loading" | "not-found" | "error" | { problem: Problem; prediction: Prediction | null; attempts: Attempt[] };
// A prediction is locked as soon as you open LeetCode; the save runs alongside the new tab.
type Locked = { text: string; status: "saving" | "saved" | "failed" };

export function ProblemPage() {
  const { slug = "" } = useParams();
  const [load, setLoad] = useState<Load>("loading");

  useEffect(() => {
    setLoad("loading");
    api(`/api/problems/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.ok) return setLoad(await res.json());
        setLoad(res.status === 404 || res.status === 400 ? "not-found" : "error");
      })
      .catch(() => setLoad("error"));
  }, [slug]);

  return (
    <main className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <BackLink />
      {load === "loading" && <p className="text-muted-foreground">Loading problem…</p>}
      {load === "not-found" && <p role="alert">Problem not found.</p>}
      {load === "error" && <p role="alert">Couldn't reach LeetCode. Try again in a moment.</p>}
      {typeof load === "object" && <ProblemView key={slug} {...load} />}
    </main>
  );
}

// Goes back to the catalog view you came from (search and filters live in its URL); a fresh tab
// has no in-app history, so it falls back to Home.
function BackLink() {
  const navigate = useNavigate();
  return (
    <Link
      to="/"
      onClick={(e) => {
        if ((window.history.state?.idx ?? 0) > 0) {
          e.preventDefault();
          navigate(-1);
        }
      }}
      className="self-start py-2 text-muted-foreground hover:text-foreground"
    >
      ← Problems
    </Link>
  );
}

function ProblemView({
  problem,
  prediction,
  attempts: loaded,
}: {
  problem: Problem;
  prediction: Prediction | null;
  attempts: Attempt[];
}) {
  const statement = useMemo(
    // LeetCode's HTML goes into our page, so anything executable is stripped first (#45).
    () => (problem.content ? DOMPurify.sanitize(problem.content) : null),
    [problem.content],
  );
  const leetCodeUrl = `https://leetcode.com/problems/${problem.slug}/`;
  const [showTopics, setShowTopics] = useState(false);
  // A recorded attempt claims the prediction, so the panel starts fresh for the next attempt.
  const [panel, setPanel] = useState({ key: 0, saved: prediction });
  const [attempts, setAttempts] = useState(loaded);

  return (
    <>
      <header className="flex flex-col gap-3">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
          <span className="font-mono text-muted-foreground">{problem.id}.</span> {problem.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <DifficultyBadge difficulty={problem.difficulty} />
          {/* Topics give the pattern away, so they stay hidden until you ask (#46). */}
          {problem.tags.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 text-muted-foreground"
              aria-expanded={showTopics}
              onClick={() => setShowTopics(!showTopics)}
            >
              {showTopics ? "Hide topics" : `Show topics (${problem.tags.length})`}
            </Button>
          )}
          {showTopics &&
            problem.tags.map((t) => (
              <span key={t.slug} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
                {t.name}
              </span>
            ))}
        </div>
      </header>

      {problem.paid ? (
        <div className="flex flex-col items-start gap-4 rounded-[10px] border p-5">
          <p>This is a Premium-only problem, so its statement isn't available here.</p>
          <a href={leetCodeUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
            View on LeetCode
          </a>
        </div>
      ) : (
        <>
          {statement && <div className="statement" dangerouslySetInnerHTML={{ __html: statement }} />}
          <PredictionPanel key={panel.key} problem={problem} saved={panel.saved} leetCodeUrl={leetCodeUrl} />
          <RecordAttempt
            problem={problem}
            onRecorded={(attempt) => {
              setPanel(({ key }) => ({ key: key + 1, saved: null }));
              setAttempts((list) => [attempt, ...list]);
            }}
          />
          <PastAttempts attempts={attempts} />
        </>
      )}
    </>
  );
}

function PredictionPanel({
  problem,
  saved,
  leetCodeUrl,
}: {
  problem: Problem;
  saved: Prediction | null;
  leetCodeUrl: string;
}) {
  const [draft, setDraft] = useState("");
  const [locked, setLocked] = useState<Locked | null>(saved && { text: saved.text, status: "saved" });

  const save = async (text: string) => {
    setLocked({ text, status: "saving" });
    try {
      const res = await api("/api/predictions", {
        method: "POST",
        body: JSON.stringify({ problemId: problem.id, slug: problem.slug, text }),
      });
      setLocked({ text, status: res.ok ? "saved" : "failed" });
    } catch {
      setLocked({ text, status: "failed" });
    }
  };

  const text = draft.trim();
  const openClass = buttonVariants({ className: "self-start" });

  return (
    <section aria-labelledby="prediction-h" className="flex flex-col gap-3 rounded-[10px] border p-5">
      <h2 id="prediction-h" className="text-base font-semibold">
        Your prediction
      </h2>

      {locked ? (
        <>
          <p className="rounded-lg bg-subtle px-3 py-2.5 whitespace-pre-wrap">{locked.text}</p>
          {locked.status === "failed" ? (
            <div role="alert" className="flex flex-wrap items-center gap-3">
              <span>Prediction not saved.</span>
              <Button variant="outline" size="sm" className="h-11" onClick={() => save(locked.text)}>
                Retry
              </Button>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {locked.status === "saving" ? "Saving…" : "Locked. It'll be checked after you record your attempt."}
            </p>
          )}
          <a href={leetCodeUrl} target="_blank" rel="noopener noreferrer" className={openClass}>
            Open on LeetCode
          </a>
        </>
      ) : (
        <>
          <Label htmlFor="prediction" className="font-normal text-muted-foreground">
            Which pattern or approach will solve this? It locks when you open LeetCode.
          </Label>
          <textarea
            id="prediction"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_PREDICTION_LENGTH}
            rows={3}
            placeholder="e.g. Hash map of values seen so far, one pass"
            className="rounded-lg border bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
          {/* A real link, so the browser opens the tab on the tap itself (no popup blocker); the save runs alongside. */}
          {text ? (
            <a href={leetCodeUrl} target="_blank" rel="noopener noreferrer" onClick={() => save(text)} className={openClass}>
              Open on LeetCode
            </a>
          ) : (
            <Button disabled className="self-start">
              Open on LeetCode
            </Button>
          )}
        </>
      )}
    </section>
  );
}
