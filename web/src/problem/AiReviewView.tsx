import { useState, type ReactNode } from "react";
import type { AiReview } from "../../../api/src/ai/types";
import type { Attempt } from "../../../api/src/review/types";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Markdown } from "../notes/Markdown";

const LABEL = { correct: "Correct", partial: "Partial", wrong: "Wrong", none: "No prediction" } as const;
const QUEUED_MS = 5 * 60 * 1000; // after this, assume the review isn't coming and offer the button

export const isReviewPending = (a: Attempt, review: AiReview | undefined, now = Date.now()) =>
  !review && !!a.reviewQueuedAt && now - Date.parse(a.reviewQueuedAt) < QUEUED_MS;

// The AI review of one attempt (#21, #58).
export function AiReviewView({
  attempt,
  review,
  onRequested,
}: {
  attempt: Attempt;
  review: AiReview | undefined;
  onRequested: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const request = async () => {
    setBusy(true);
    setError(undefined);
    const res = await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ problemId: attempt.problemId, createdAt: attempt.createdAt }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onRequested();
    else setError("Couldn't request the review. Try again.");
  };

  const shell = (children: ReactNode) => (
    <div className="flex flex-col gap-3 rounded-lg bg-subtle p-4">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">AI review</span>
      {children}
    </div>
  );

  if (review?.status === "done" && review.review) {
    const r = review.review;
    const parts: [string, string][] = [
      ["Optimization", r.optimization],
      ["Approach", r.approach],
      ["Conceptualization", r.conceptualization],
    ];
    return shell(
      <>
        <div className="flex flex-col gap-1">
          <span className="font-medium">Prediction: {LABEL[r.predictionLabel]}</span>
          <Markdown text={r.predictionNote} />
        </div>
        {parts.map(([title, text]) => (
          <div key={title} className="flex flex-col gap-1">
            <span className="font-medium">{title}</span>
            <Markdown text={text} />
          </div>
        ))}
        {r.tips.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="font-medium">Tips</span>
            <Markdown text={r.tips.map((t) => `- ${t}`).join("\n")} />
          </div>
        )}
      </>,
    );
  }

  if (isReviewPending(attempt, review)) return shell(<p className="text-muted-foreground">Reviewing…</p>);

  const message =
    review?.status === "failed"
      ? "Review failed."
      : review?.status === "refused"
        ? "Couldn't review this one."
        : review?.status === "skipped-budget"
          ? "Skipped: the month's AI budget was used up."
          : "No review yet.";
  return shell(
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-muted-foreground">{message}</span>
      <Button type="button" variant="outline" size="sm" className="h-11" disabled={busy} onClick={() => void request()}>
        {review?.status === "failed" || review?.status === "refused" ? "Retry" : "Request review"}
      </Button>
      {error && <span role="alert">{error}</span>}
    </div>,
  );
}
