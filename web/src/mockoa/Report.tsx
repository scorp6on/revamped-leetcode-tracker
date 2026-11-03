import { useState } from "react";
import { PASS_RATIO, type RunReport, type TestResult } from "../../../api/src/mockoa/types";
import { cn } from "../lib/utils";
import { pct } from "./helpers";

const STATUS: Record<TestResult["status"], string> = {
  passed: "passed",
  wrong: "wrong answer",
  error: "runtime error",
  timeout: "too slow (over 2 s)",
  crashed: "crashed",
  skipped: "didn't run",
};

// The result of Run examples or Submit: a square per test, then the failed test you pick (#62).
export function Report({ report }: { report: RunReport }) {
  const firstBad = report.results.findIndex((r) => r.status !== "passed");
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ?? (firstBad === -1 ? null : firstBad);
  const test = shown === null ? null : report.results[shown];
  const others = report.results.map((r, i) => (r.status !== "passed" && i !== shown ? i + 1 : 0)).filter(Boolean);

  if (report.compileError) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-[10px] border p-3.5">
        <strong className="font-semibold">Your code didn't run</strong>
        <pre className="overflow-x-auto rounded-lg bg-subtle p-3 font-mono text-[13px] whitespace-pre-wrap">{report.compileError}</pre>
      </div>
    );
  }
  const share = pct(report.passed, report.total);
  return (
    <div role="status" className="flex flex-col gap-2.5 rounded-[10px] border p-3.5">
      <div className="flex flex-col gap-0.5">
        <strong className="text-base font-semibold">
          {report.passed} of {report.total} tests passed · {share}%
        </strong>
        <span className="text-[13px] text-muted-foreground">
          {report.submit
            ? report.passed / Math.max(1, report.total) >= PASS_RATIO
              ? `✓ Counts as passed (${PASS_RATIO * 100}% needed)`
              : `Not passed yet (${PASS_RATIO * 100}% needed)`
            : "Run examples doesn't count; Submit does."}
        </span>
      </div>
      <div className="flex flex-wrap gap-[3px]">
        {report.results.map((r, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Test ${i + 1}: ${STATUS[r.status]}`}
            title={`Test ${i + 1}: ${STATUS[r.status]}`}
            aria-pressed={shown === i}
            onClick={() => setPicked(i)}
            className={cn(
              "flex size-[22px] items-center justify-center rounded-[4px] border text-xs",
              r.status === "passed" ? "border-muted-foreground bg-muted-foreground" : "border-foreground",
              shown === i && "outline-2 outline-offset-1 outline-foreground",
            )}
          >
            {r.status === "passed" ? "" : "×"}
          </button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">Filled square = passed · × = failed. Tap a square to see that test.</span>
      {test && shown !== null && (
        <div className="flex flex-col gap-1.5 border-t pt-2.5">
          <strong className="font-semibold">
            Test {shown + 1}: {STATUS[test.status]}
          </strong>
          {test.status !== "passed" && (
            <pre className="overflow-x-auto rounded-lg bg-subtle p-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
              {[
                test.input && `Input     ${test.input}`,
                test.expected && `Expected  ${test.expected}`,
                test.output !== undefined && `Yours     ${test.output}`,
                test.error && `Error     ${test.error}`,
              ]
                .filter(Boolean)
                .join("\n")}
            </pre>
          )}
          {test.stdout && (
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-[13px] text-muted-foreground">Your prints</summary>
              <pre className="overflow-x-auto rounded-lg bg-subtle p-3 font-mono text-[13px] whitespace-pre-wrap">{test.stdout}</pre>
            </details>
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
