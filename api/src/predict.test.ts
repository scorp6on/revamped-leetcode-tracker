import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { makePredictHandler } from "./predict";
import { MAX_PREDICTION_LENGTH, type Prediction } from "./problems/types";

const NOW = Date.parse("2026-10-28T12:00:00Z");

const setup = () => {
  const saved: Prediction[] = [];
  const handler = makePredictHandler({
    predictions: { save: async (p) => void saved.push(p) },
    now: () => NOW,
  });
  const post = async (body: unknown) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const res = (await handler({ body: raw } as APIGatewayProxyEventV2)) as {
      statusCode: number;
      body: string;
    };
    return { statusCode: res.statusCode, body: JSON.parse(res.body) };
  };
  return { post, saved };
};

const valid = { problemId: "1", slug: "two-sum", text: "hash map of seen values" };

describe("POST /api/predictions", () => {
  it("saves a valid prediction, unclaimed, stamped with the current time", async () => {
    const { post, saved } = setup();
    const res = await post({ ...valid, text: "  hash map of seen values  " });

    expect(res.statusCode).toBe(201);
    expect(saved).toEqual([
      { problemId: "1", slug: "two-sum", text: "hash map of seen values", createdAt: "2026-10-28T12:00:00.000Z", claimed: false },
    ]);
  });

  it(`requires 1–${MAX_PREDICTION_LENGTH} characters of prediction`, async () => {
    const { post, saved } = setup();
    expect((await post({ ...valid, text: "   " })).statusCode).toBe(400);
    expect((await post({ ...valid, text: "x".repeat(MAX_PREDICTION_LENGTH + 1) })).statusCode).toBe(400);
    expect((await post({ ...valid, text: "x".repeat(MAX_PREDICTION_LENGTH) })).statusCode).toBe(201);
    expect(saved).toHaveLength(1);
  });

  it("requires a numeric problem ID and a valid slug", async () => {
    const { post, saved } = setup();
    expect((await post({ ...valid, problemId: undefined })).statusCode).toBe(400);
    expect((await post({ ...valid, problemId: "1#SK" })).statusCode).toBe(400);
    expect((await post({ ...valid, slug: "Two Sum" })).statusCode).toBe(400);
    expect(saved).toHaveLength(0);
  });

  it("rejects a body that isn't JSON", async () => {
    const { post } = setup();
    expect((await post("not json")).statusCode).toBe(400);
  });
});
