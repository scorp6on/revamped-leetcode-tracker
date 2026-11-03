import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { shortDate } from "../queue/useSchedule";
import { localToday } from "../queue/rank";

interface TestsInfo {
  status: "full" | "limited";
  reason: string | null;
  writtenAt: string;
  model: string | null;
  small: number;
  large: number;
  flagged: { id: string; large: boolean; input: string | null }[];
}

const REWRITE_WAIT_MS = 3 * 60_000;

// The problem page's "Mock OA tests" (#63 D): only for problems that have been in a mock OA. This is
// where you un-flag a test, or have the AI write a fresh set.
export function MockTests({ problemId, slug }: { problemId: string; slug: string }) {
  const [info, setInfo] = useState<TestsInfo | null>(null);
  const [rewriting, setRewriting] = useState<number | null>(null); // when you asked
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api(`/api/mock-tests/${problemId}`)
        .then((res) => (res.ok ? (res.json() as Promise<{ tests: TestsInfo | null }>) : null))
        .then((d) => {
          if (!d) return;
          setInfo(d.tests);
          return d.tests;
        })
        .catch(() => undefined),
    [problemId],
  );
  useEffect(() => void load(), [load]);

  // After Rewrite: look again every 10 s until the new set lands, for up to 3 minutes.
  useEffect(() => {
    if (rewriting === null) return;
    const id = setInterval(async () => {
      const t = await load();
      if (t && Date.parse(t.writtenAt) >= rewriting) {
        setRewriting(null);
        setNotice(t.status === "full" ? "New tests are ready." : `The rewrite didn't take: ${t.reason ?? "try again later"}.`);
      } else if (Date.now() - rewriting > REWRITE_WAIT_MS) {
        setRewriting(null);
        setNotice("Still writing; check back in a few minutes.");
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [rewriting, load]);

  if (!info) return null;
  const ai = info.small + info.large;
  return (
    <section aria-labelledby="mocktests-h" className="flex flex-col gap-2.5 rounded-[10px] border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mocktests-h" className="text-base font-semibold">
          Mock OA tests
        </h2>
        <span className="text-[13px] text-muted-foreground">
          {info.status === "full" && ai > 0
            ? `${ai} written by AI on ${shortDate(localToday(new Date(info.writtenAt)))} (${info.large} large) · ${info.flagged.length} flagged`
            : `Examples only · ${info.reason ?? "no AI tests yet"}`}
        </span>
      </div>
      {info.flagged.map((f) => (
        <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
          <span className="min-w-[200px] flex-1 font-mono text-[13px] break-all">
            Test {f.id} · {f.large ? "a large generated input" : (f.input ?? "").split("\n").join(", ")}
          </span>
          <Button
            variant="outline"
            className="h-9"
            onClick={async () => {
              const res = await api(`/api/mock-tests/${problemId}/unflag`, { method: "POST", body: JSON.stringify({ testId: f.id }) }).catch(() => null);
              if (res?.ok) void load();
              else setNotice("Couldn't un-flag it. Try again.");
            }}
          >
            Un-flag
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          className="h-10"
          disabled={rewriting !== null}
          onClick={async () => {
            setNotice(null);
            const res = await api(`/api/mock-tests/${problemId}/rewrite`, { method: "POST", body: JSON.stringify({ slug }) }).catch(() => null);
            if (res?.ok) setRewriting(Date.now() - 5000);
            else setNotice(res ? ((await res.json()).error ?? "Couldn't start a rewrite.") : "Couldn't reach the server.");
          }}
        >
          {rewriting !== null ? "Rewriting…" : "Rewrite tests"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {info.flagged.length > 0 ? "Un-flagging only changes later mock OAs; past scores stay as they were. " : ""}
          Rewrite has the AI write a fresh set (under 1¢) and clears the flags.
        </span>
      </div>
      {notice && (
        <p role="status" className="text-[13px]">
          {notice}
        </p>
      )}
    </section>
  );
}
