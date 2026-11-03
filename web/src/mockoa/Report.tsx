import { useState } from "react";
import { PASS_RATIO, type RunReport, type TestResult } from "../../../api/src/mockoa/types";
import { cn } from "../lib/utils";
import { pct } from "./helpers";

const STATUS: Record<TestResult["status"], string> = {
  passed: "passed",
  wrong: "wrong answer",
  error: "runtime error",
  timeout: "too slow",
  invalid: "broken test (doesn't count)",
  crashed: "crashed",
  skipped: "didn't run",
};

const ms = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 })} ms`;

// The result of Run examples or Submit: a square per test, then the failed test you pick (#62, #63).
// AI-written tests can be flagged as wrong; flagged ones don't count.
export function Report({
  report,
  flagged = [],
  onFlag,
}: {
  report: RunReport;
  flagged?: string[];
  onFlag?: (testId: string, flagged: boolean) => Promise<void>;
}) {
  const counted = (r: TestResult) => r.status !== "invalid" && !(r.testId && flagged.includes(r.testId));
  const firstBad = report.results.findIndex((r) => r.status !== "passed" && counted(r));
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = picked ?? (firstBad === -1 ? null : firstBad);
  const test = shown === null ? null : report.results[shown];
  const others = report.results.map((r, i) => (r.status !== "passed" && counted(r) && i !== shown ? i + 1 : 0)).filter(Boolean);
  const examples = report.results.filter((r) => r.source === "example").length;
  const ai = report.results.filter((r) => r.source === "ai").length;

  if (report.compileError) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-[10px] border p-3.5">
        <strong className="font-semibold">Your code didn't run</strong>
        <pre className="overflow-x-auto rounded-lg bg-subtle p-3 font-mono text-[13px] whitespace-pre-wrap">{report.compileError}</pre>
      </div>
    );
  }
  const isFlagged = !!test?.testId && flagged.includes(test.testId);
  return (
    <div role="status" className="flex flex-col gap-2.5 rounded-[10px] border p-3.5">
      <div className="flex flex-col gap-0.5">
        <strong className="text-base font-semibold">
          {report.passed} of {report.total} tests passed · {pct(report.passed, report.total)}%
        </strong>
        <span className="text-[13px] text-muted-foreground">
          {report.submit
            ? report.passed / Math.max(1, report.total) >= PASS_RATIO
              ? `✓ Counts as passed (${PASS_RATIO * 100}% needed)`
              : `Not passed yet (${PASS_RATIO * 100}% needed)`
            : "Run examples checks LeetCode's examples and doesn't count; Submit runs every test."}
          {ai > 0 && ` · ${examples} example${examples === 1 ? "" : "s"} + ${ai} written by AI`}
        </span>
      </div>
      <div className="flex flex-wrap gap-[3px]">
        {report.results.map((r, i) => {
          const off = !counted(r);
          const label = `Test ${i + 1}: ${off && r.status !== "invalid" ? "flagged" : STATUS[r.status]}${r.large ? " · large" : ""}`;
          return (
            <button
              key={i}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={shown === i}
              onClick={() => setPicked(i)}
              className={cn(
                "flex size-[22px] items-center justify-center rounded-[4px] border text-xs",
                off ? "border-dashed border-muted-foreground text-muted-foreground" : r.status === "passed" ? "border-muted-foreground bg-muted-foreground" : "border-foreground",
                shown === i && "outline-2 outline-offset-1 outline-foreground",
              )}
            >
              {off ? "⚑" : r.status === "passed" ? "" : r.status === "timeout" ? "◷" : "×"}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground">Filled = passed · × = failed · ◷ = too slow · ⚑ = flagged. Tap a square to see that test.</span>
      {test && shown !== null && (
        <div className="flex flex-col gap-1.5 border-t pt-2.5">
          <strong className="font-semibold">
            Test {shown + 1}: {isFlagged ? "flagged" : STATUS[test.status]}
            {test.large ? " · a large input" : ""}
            {test.source === "ai" ? " · written by AI" : test.source === "example" ? " · LeetCode's example" : ""}
          </strong>
          {test.status !== "passed" && (
            <pre className="overflow-x-auto rounded-lg bg-subtle p-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
              {[
                test.input && `Input     ${test.input}`,
                test.expected && `Expected  ${test.expected}${test.status === "timeout" ? " · your answer wasn't checked" : ""}`,
                test.output !== undefined && `Yours     ${test.output}`,
                test.status === "timeout" && test.limitMs !== undefined &&
                  `Time      over ${ms(test.limitMs)} (the limit) · reference ${test.refMs !== undefined ? ms(test.refMs) : "?"}`,
                test.status !== "timeout" && test.ms !== undefined && test.refMs !== undefined && `Time      ${ms(test.ms)} · reference ${ms(test.refMs)}`,
                test.error && `Error     ${test.error}`,
              ]
                .filter(Boolean)
                .join("\n")}
            </pre>
          )}
          {test.status === "timeout" && (
            <span className="text-[13px] text-muted-foreground">
              Too slow means more than 5× the reference solution's time on this test. Large tests are how brute force gets caught.
            </span>
          )}
          {test.stdout && (
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-[13px] text-muted-foreground">Your prints</summary>
              <pre className="overflow-x-auto rounded-lg bg-subtle p-3 font-mono text-[13px] whitespace-pre-wrap">{test.stdout}</pre>
            </details>
          )}
          {onFlag && test.source === "ai" && test.testId && test.status !== "passed" && test.status !== "invalid" && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onFlag(test.testId!, !isFlagged);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="h-10 rounded-[10px] border px-3.5 font-medium hover:bg-subtle disabled:opacity-50"
              >
                {isFlagged ? "Undo flag" : "⚑ This test looks wrong"}
              </button>
              <span className="text-[13px] text-muted-foreground">
                {isFlagged ? "Flagged: it doesn't count here or in later mock OAs." : "It won't count here or in later mock OAs."}
              </span>
            </div>
          )}
          {others.length > 0 && (
            <span className="text-[13px] text-muted-foreground">
              Test{others.length === 1 ? "" : "s"} {others.join(", ")} also failed
            </span>
          )}
        </div>
      )}
    </div>
  );
}
