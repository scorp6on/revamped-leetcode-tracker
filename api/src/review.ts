import type { SQSEvent } from "aws-lambda";
import { costOf, makeClaude, type ClaudeResult } from "./ai/claude";
import { buildUserMessage } from "./ai/prompt";
import { dynamoAiStore, type AiStore } from "./ai/store";
import { monthOf, type ReviewMessage } from "./ai/types";
import { getSecret } from "./auth/secrets";
import { fetchProblem } from "./problems/leetcode";

const MAX_TRIES = 3; // matches the queue's maxReceiveCount

export interface ReviewDeps {
  store: AiStore;
  statement: (slug: string) => Promise<string | null>;
  claude: (userMessage: string) => Promise<ClaudeResult>;
  capUsd: number;
  now: () => number;
}

export const makeReviewWork =
  ({ store, statement, claude, capUsd, now }: ReviewDeps) =>
  async ({ problemId, createdAt }: ReviewMessage): Promise<void> => {
    const attempt = await store.attempt(problemId, createdAt);
    if (!attempt) return; // nothing to review; retrying won't help

    // Queues can deliver a message twice: a finished review is never paid for again (#58).
    if ((await store.review(problemId, createdAt))?.status === "done") return;

    const at = new Date(now()).toISOString();
    const month = monthOf(now());
    // At the cap: attempts and SM-2 carry on, and the review can be requested next month (#33).
    if ((await store.spent(month)) >= capUsd) {
      await store.saveReview(problemId, { attemptCreatedAt: createdAt, status: "skipped-budget", createdAt: at });
      return;
    }

    const result = await claude(buildUserMessage(attempt, await statement(attempt.slug)));
    const costUsd = costOf(result.usage);
    await store.addSpend(month, costUsd);
    await store.saveReview(
      problemId,
      result.kind === "review"
        ? { attemptCreatedAt: createdAt, status: "done", review: result.review, costUsd, createdAt: at }
        : { attemptCreatedAt: createdAt, status: "refused", costUsd, createdAt: at },
    );
  };

export const makeReviewHandler =
  (store: Pick<AiStore, "saveReview">, work: (m: ReviewMessage) => Promise<void>, now: () => number) =>
  async (event: SQSEvent): Promise<void> => {
    for (const record of event.Records) {
      const message = JSON.parse(record.body) as ReviewMessage;
      try {
        await work(message);
      } catch (err) {
        console.error("review failed", message, err);
        // Last try: show Retry on the attempt. Then throw so the message goes to the dead-letter queue.
        if (Number(record.attributes.ApproximateReceiveCount) >= MAX_TRIES) {
          await store.saveReview(message.problemId, {
            attemptCreatedAt: message.createdAt,
            status: "failed",
            createdAt: new Date(now()).toISOString(),
          });
        }
        throw err;
      }
    }
  };

const store = dynamoAiStore(process.env.TABLE_NAME ?? "");

export const handler = makeReviewHandler(
  store,
  makeReviewWork({
    store,
    statement: async (slug) => (await fetchProblem(slug))?.content ?? null,
    claude: async (message) => makeClaude(await getSecret("anthropic-api-key"))(message),
    capUsd: Number(process.env.BUDGET_CAP ?? 0),
    now: Date.now,
  }),
  Date.now,
);
