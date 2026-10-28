import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { makeProblemHandler } from "./problem";
import type { Prediction, Problem } from "./problems/types";
import { PREDICTION_WINDOW_MS } from "./problems/prediction";

const NOW = Date.parse("2026-10-28T12:00:00Z");

const twoSum: Problem = {
  id: "1",
  title: "Two Sum",
  slug: "two-sum",
  difficulty: "Easy",
  paid: false,
  tags: [{ name: "Array", slug: "array" }],
  content: "<p>Find two numbers.</p>",
};

const predictionAt = (ms: number, claimed = false): Prediction => ({
  problemId: "1",
  slug: "two-sum",
  text: "hash map of seen values",
  createdAt: new Date(ms).toISOString(),
  claimed,
});

const setup = ({
  problem = twoSum as Problem | null | Error,
  latest = undefined as Prediction | undefined,
} = {}) => {
  const handler = makeProblemHandler({
    fetchProblem: async () => {
      if (problem instanceof Error) throw problem;
      return problem;
    },
    predictions: { latest: async () => latest },
    now: () => NOW,
  });
  return async (slug: string) => {
    const res = (await handler({ pathParameters: { slug } } as unknown as APIGatewayProxyEventV2)) as {
      statusCode: number;
      body: string;
    };
    return { statusCode: res.statusCode, body: JSON.parse(res.body) };
  };
};

describe("GET /api/problems/{slug}", () => {
  it("rejects a malformed slug without calling LeetCode", async () => {
    const get = setup({ problem: new Error("should not be called") });
    expect((await get("Two Sum")).statusCode).toBe(400);
    expect((await get("../etc")).statusCode).toBe(400);
  });

  it("answers 404 for a problem LeetCode doesn't know", async () => {
    expect((await setup({ problem: null })("nope")).statusCode).toBe(404);
  });

  it("answers 502 when LeetCode fails", async () => {
    expect((await setup({ problem: new Error("down") })("two-sum")).statusCode).toBe(502);
  });

  it("returns a Premium problem with no statement and no prediction", async () => {
    const res = await setup({
      problem: { ...twoSum, paid: true, content: "should not leak" },
      latest: predictionAt(NOW - 1000),
    })("two-sum");
    expect(res.statusCode).toBe(200);
    expect(res.body.problem.content).toBeNull();
    expect(res.body.prediction).toBeNull();
  });

  it("returns the problem with an unclaimed prediction under 24 hours old", async () => {
    const latest = predictionAt(NOW - PREDICTION_WINDOW_MS + 1000);
    const res = await setup({ latest })("two-sum");
    expect(res.statusCode).toBe(200);
    expect(res.body.problem.content).toBe(twoSum.content);
    expect(res.body.prediction).toEqual(latest);
  });

  it("leaves out a prediction that's claimed or older than 24 hours", async () => {
    expect((await setup({ latest: predictionAt(NOW - 1000, true) })("two-sum")).body.prediction).toBeNull();
    expect((await setup({ latest: predictionAt(NOW - PREDICTION_WINDOW_MS) })("two-sum")).body.prediction).toBeNull();
  });
});
