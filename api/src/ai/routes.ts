import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { json, readBody } from "../http";
import type { ReviewStore } from "../review/store";
import type { AiStore } from "./store";
import { monthOf, type BudgetStatus, type ReviewMessage } from "./types";

export interface AiRouteDeps {
  store: Pick<AiStore, "attempt" | "review" | "spent">;
  reviews: Pick<ReviewStore, "aiReviews">;
  enqueue: (m: ReviewMessage) => Promise<void>;
  capUsd: number;
  now: () => number;
}

export const makeAiRoutes = ({ store, reviews, enqueue, capUsd, now }: AiRouteDeps) => ({
  // Request review / Retry (#58): any attempt without a finished review.
  request: async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const { problemId, createdAt } = readBody(event);
    if (typeof problemId !== "string" || !/^\d+$/.test(problemId) || typeof createdAt !== "string") {
      return json(400, { error: "problemId and createdAt required" });
    }
    if (!(await store.attempt(problemId, createdAt))) return json(404, { error: "no such attempt" });
    if ((await store.review(problemId, createdAt))?.status === "done") return json(409, { error: "already reviewed" });
    await enqueue({ problemId, createdAt });
    return json(202, { queued: true });
  },

  // Polled by the problem page while a review is on its way.
  list: async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const problemId = event.queryStringParameters?.problemId ?? "";
    if (!/^\d+$/.test(problemId)) return json(400, { error: "problemId required" });
    return json(200, { reviews: await reviews.aiReviews(problemId) });
  },

  budget: async (): Promise<APIGatewayProxyResultV2> => {
    const month = monthOf(now());
    const status: BudgetStatus = { month, spentUsd: await store.spent(month), capUsd };
    return json(200, status);
  },
});
