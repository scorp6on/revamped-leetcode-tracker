import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { json } from "./http";
import { SLUG } from "./problems/leetcode";
import { dynamoPredictionStore, type PredictionStore } from "./problems/prediction";
import { MAX_PREDICTION_LENGTH } from "./problems/types";

export interface PredictDeps {
  predictions: Pick<PredictionStore, "save">;
  now: () => number;
}

const readBody = (event: APIGatewayProxyEventV2): Record<string, unknown> => {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body;
  try {
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
};

// The page locks a prediction once it's saved; with a single user, the server doesn't re-check that.
export const makePredictHandler =
  ({ predictions, now }: PredictDeps) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const { problemId, slug, text } = readBody(event);
    if (typeof problemId !== "string" || !/^\d+$/.test(problemId)) return json(400, { error: "problemId required" });
    if (typeof slug !== "string" || !SLUG.test(slug)) return json(400, { error: "slug required" });
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed || trimmed.length > MAX_PREDICTION_LENGTH) {
      return json(400, { error: `prediction must be 1–${MAX_PREDICTION_LENGTH} characters` });
    }

    const prediction = { problemId, slug, text: trimmed, createdAt: new Date(now()).toISOString(), claimed: false };
    await predictions.save(prediction);
    return json(201, { prediction });
  };

export const handler = makePredictHandler({
  predictions: dynamoPredictionStore(process.env.TABLE_NAME ?? ""),
  now: Date.now,
});
