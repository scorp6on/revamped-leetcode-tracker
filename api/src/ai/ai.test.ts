import type { SQSEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { makeReviewHandler, makeReviewWork } from "../review";
import type { Attempt } from "../review/types";
import { costOf, type ClaudeResult } from "./claude";
import { buildUserMessage, stripImages } from "./prompt";
import type { AiStore } from "./store";
import type { AiReview, ReviewBody } from "./types";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const AT = "2026-11-15T11:00:00.000Z";

const attempt = {
  problemId: "1", slug: "two-sum", title: "Two Sum", difficulty: "Easy", tags: [], outcome: "struggled",
  confidence: 2, minutes: 30, failureMode: "off-by-one", approach: "used a map ![](/img/a.jpg)", learned: "complement lookup",
  reflection: "rushed", localDate: "2026-11-15", createdAt: AT, quality: 2, prediction: "hash map", code: "class Solution: ...",
} as Attempt;

const body: ReviewBody = {
  predictionLabel: "correct", predictionNote: "Yes", optimization: "O(n)", approach: "Same", conceptualization: "Lookup", tips: ["Test"],
};
const usage = { input_tokens: 1000, output_tokens: 1000 };

const setup = ({ existing, spent = 0, result = { kind: "review", review: body, usage } as ClaudeResult } = {} as {
  existing?: AiReview; spent?: number; result?: ClaudeResult;
}) => {
  const saved: AiReview[] = [];
  let total = spent;
  let calls = 0;
  const store: AiStore = {
    attempt: async () => attempt,
    review: async () => existing,
    saveReview: async (_p, r) => void saved.push(r),
    spent: async () => total,
    addSpend: async (_m, usd) => void (total += usd),
  };
  const work = makeReviewWork({
    store,
    statement: async () => "<p>Find two numbers.</p>",
    claude: async () => {
      calls += 1;
      return result;
    },
    capUsd: 10,
    now: () => NOW,
  });
  return { store, work, saved, calls: () => calls, total: () => total };
};
const message = { problemId: "1", createdAt: AT };

describe("building the prompt", () => {
  it("includes the statement, prediction, grade, notes and code, without images", () => {
    const text = buildUserMessage(attempt, "<p>Find two numbers.</p>");
    for (const part of ["Find two numbers", "hash map", "Off-by-one", "complement lookup", "rushed", "class Solution"]) {
      expect(text).toContain(part);
    }
    expect(text).not.toContain("/img/a.jpg");
    expect(stripImages("a ![x](/img/b.jpg) c")).toBe("a [image omitted] c");
  });

  it("marks missing code and predictions as none", () => {
    const text = buildUserMessage({ ...attempt, code: null, prediction: null }, null);
    expect(text).toContain("<code>\n(none)\n</code>");
    expect(text).toContain("<prediction>\n(none)\n</prediction>");
  });
});

describe("cost", () => {
  it("multiplies tokens by Sonnet 5.5 prices", () => {
    expect(costOf({ input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(2);
    expect(costOf({ input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(10);
    expect(costOf({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2);
  });
});

describe("reviewing", () => {
  it("saves the review and adds its cost to the month", async () => {
    const t = setup();
    await t.work(message);
    expect(t.saved[0]).toMatchObject({ status: "done", review: body, attemptCreatedAt: AT });
    expect(t.total()).toBeCloseTo(0.012);
  });

  it("never pays twice when a message is delivered again", async () => {
    const t = setup({ existing: { attemptCreatedAt: AT, status: "done", createdAt: AT } });
    await t.work(message);
    expect(t.calls()).toBe(0);
    expect(t.saved).toHaveLength(0);
  });

  it("can redo a failed or skipped review", async () => {
    const t = setup({ existing: { attemptCreatedAt: AT, status: "failed", createdAt: AT } });
    await t.work(message);
    expect(t.calls()).toBe(1);
  });

  it("skips without calling Claude at the cap", async () => {
    const t = setup({ spent: 10 });
    await t.work(message);
    expect(t.calls()).toBe(0);
    expect(t.saved[0].status).toBe("skipped-budget");
  });

  it("records a refusal instead of retrying", async () => {
    const t = setup({ result: { kind: "refused", usage } });
    await t.work(message);
    expect(t.saved[0].status).toBe("refused");
  });
});

describe("the queue handler", () => {
  const event = (count: number) =>
    ({ Records: [{ body: JSON.stringify(message), attributes: { ApproximateReceiveCount: String(count) } }] }) as unknown as SQSEvent;
  const boom = async () => {
    throw new Error("Claude is down");
  };

  it("throws so the queue retries, marking failed only on the last try", async () => {
    const t = setup();
    const handler = makeReviewHandler(t.store, boom, () => NOW);
    await expect(handler(event(1))).rejects.toThrow("Claude is down");
    expect(t.saved).toHaveLength(0);
    await expect(handler(event(3))).rejects.toThrow("Claude is down");
    expect(t.saved[0].status).toBe("failed");
  });
});
