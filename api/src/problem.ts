import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { json } from "./http";
import { SLUG } from "./problems/leetcode";
import type { Problem } from "./problems/types";
import { isActive, type PredictionStore } from "./problems/prediction";

export interface ProblemDeps {
  fetchProblem: (slug: string) => Promise<Problem | null>;
  predictions: Pick<PredictionStore, "latest">;
  now: () => number;
}

export const makeProblemHandler =
  (deps: ProblemDeps) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const slug = event.pathParameters?.slug ?? "";
    if (!SLUG.test(slug)) return json(400, { error: "invalid problem slug" });

    let problem: Problem | null;
    try {
      problem = await deps.fetchProblem(slug);
    } catch (err) {
      console.error("LeetCode fetch failed", err);
      return json(502, { error: "Couldn't reach LeetCode" });
    }
    if (!problem) return json(404, { error: "Problem not found" });

    // No Premium account (#44): Premium problems get no statement and no prediction box.
    if (problem.paid) return json(200, { problem: { ...problem, content: null }, prediction: null });

    // The ID comes from LeetCode's answer, so this read has to wait for it.
    const latest = await deps.predictions.latest(problem.id);
    return json(200, { problem, prediction: latest && isActive(latest, deps.now()) ? latest : null });
  };
