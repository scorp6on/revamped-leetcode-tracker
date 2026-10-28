import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { makeAttemptHandler } from "./attempt";
import { json } from "./http";
import { makePredictHandler } from "./predict";
import { makeProblemHandler } from "./problem";
import { fetchProblem } from "./problems/leetcode";
import { dynamoPredictionStore } from "./problems/prediction";
import { dynamoReviewStore } from "./review/store";

type Route = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

// The one API Lambda for app routes (#26, #49): it stays warm across pages. Every route here is
// behind the authorizer; login, logout and health have their own Lambdas.
export const makeApiHandler =
  (routes: Record<string, Route>) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const route = routes[event.routeKey];
    return route ? route(event) : json(404, { error: "no such route" });
  };

const table = process.env.TABLE_NAME ?? "";
const predictions = dynamoPredictionStore(table);
const reviews = dynamoReviewStore(table);

export const handler = makeApiHandler({
  // Only reachable through the authorizer, so getting here means the token is valid.
  "GET /api/me": async () => json(200, { loggedIn: true }),
  "GET /api/problems/{slug}": makeProblemHandler({ fetchProblem, predictions, now: Date.now }),
  "POST /api/predictions": makePredictHandler({ predictions, now: Date.now }),
  "POST /api/attempts": makeAttemptHandler({ reviews, predictions, now: Date.now }),
  "GET /api/schedule": async () => json(200, await reviews.overview()),
});
