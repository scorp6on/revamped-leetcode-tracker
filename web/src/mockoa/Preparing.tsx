import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { PREPARE_MS, type SessionView } from "../../../api/src/mockoa/types";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { clockOffset } from "./helpers";

const POLL_MS = 2000;

// After Start, while the AI writes tests for problems that have none (#63). The clock starts when every
// problem is ready, or after 90 s with the rest on examples only.
export function Preparing({ session, onUpdate }: { session: SessionView; onUpdate: (s: SessionView) => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const offset = clockOffset(session.now, Date.now());
  const since = Date.parse(session.preparingSince ?? session.createdAt);
  const [now, setNow] = useState(() => Date.now() + offset);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now() + offset), 1000);
    const poll = setInterval(() => {
      api(`/api/mockoa/${session.id}`)
        .then((res) => (res.ok ? (res.json() as Promise<{ session: SessionView }>) : Promise.reject()))
        .then((d) => {
          setError(null);
          onUpdate(d.session);
        })
        .catch(() => setError("Lost the connection; still trying."));
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [session.id, offset, onUpdate]);

  const waitLeft = Math.max(0, Math.ceil((since + PREPARE_MS - now) / 1000));
  const writing = session.problems.filter((p) => p.testStatus === "writing").length;

  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 py-10 sm:px-6">
      <section aria-labelledby="prep-h" aria-live="polite" className="flex flex-col gap-3.5 rounded-[10px] border p-5">
        <div>
          <h1 id="prep-h" className="text-base font-semibold">
            Getting your mock OA ready
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {session.count} problem{session.count === 1 ? "" : "s"} · {session.minutes} min · the clock starts when all are ready
            {writing > 0 && waitLeft > 0 && `, or in ${waitLeft} s at most`}
          </p>
        </div>
        <ul className="flex flex-col">
          {session.problems.map((p) => (
            <li key={p.index} className="flex items-center gap-3 border-t py-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-[22px] items-center justify-center rounded-full border text-xs",
                  p.testStatus === "writing" ? "border-muted-foreground text-muted-foreground" : "border-foreground bg-foreground text-background",
                )}
              >
                {p.testStatus === "writing" ? "…" : "✓"}
              </span>
              <span className="font-medium">Problem {p.index + 1}</span>
              <span className="ml-auto text-[13px] text-muted-foreground">
                {p.testStatus === "writing"
                  ? "Writing and checking tests…"
                  : p.testStatus === "limited"
                    ? "Ready · examples only"
                    : `Ready · ${p.testCounts.ai} AI tests`}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            className="h-10"
            onClick={async () => {
              if (!window.confirm("Cancel this test? It's deleted and won't count anywhere.")) return;
              const res = await api(`/api/mockoa/${session.id}`, { method: "DELETE" }).catch(() => null);
              if (res?.ok) navigate("/mock-oa", { replace: true });
              else setError("Couldn't cancel it. Try again.");
            }}
          >
            Cancel
          </Button>
          <span className="text-xs text-muted-foreground">About 20 s per new problem · under 1¢ each, from your monthly AI budget</span>
        </div>
        {error && (
          <p role="alert" className="text-[13px]">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
