import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { makeAiRoutes } from "./ai/routes";
import { dynamoAiStore } from "./ai/store";
import type { ReviewMessage } from "./ai/types";
import { makeAttemptHandler } from "./attempt";
import { json } from "./http";
import { makePredictHandler } from "./predict";
import { makeProblemHandler } from "./problem";
import { fetchProblem } from "./problems/leetcode";
import { dynamoPredictionStore } from "./problems/prediction";
import { dynamoReviewStore } from "./review/store";
import { makeStatsHandler } from "./stats/route";
import { dynamoStatsStore } from "./stats/store";
import { makeSyncRoutes } from "./sync/routes";
import { dynamoSyncStore } from "./sync/store";
import { newToken } from "./sync/token";
import { uploadHandler } from "./uploads";

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
const lambda = new LambdaClient({});
const sqs = new SQSClient({});
const queueReview = async (message: ReviewMessage) => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.REVIEW_QUEUE_URL, MessageBody: JSON.stringify(message) }));
};
const ai = makeAiRoutes({
  store: dynamoAiStore(table),
  reviews,
  enqueue: queueReview,
  capUsd: Number(process.env.BUDGET_CAP ?? 0),
  now: Date.now,
});
const sync = makeSyncRoutes({
  store: dynamoSyncStore(table),
  // "Event" = start it and return at once; the page polls for the result.
  runBackup: async () => {
    await lambda.send(new InvokeCommand({ FunctionName: process.env.BACKUP_FN, InvocationType: "Event" }));
  },
  newToken,
  now: Date.now,
});

export const handler = makeApiHandler({
  // Only reachable through the authorizer, so getting here means the token is valid.
  "GET /api/me": async () => json(200, { loggedIn: true }),
  "GET /api/problems/{slug}": makeProblemHandler({ fetchProblem, predictions, reviews, now: Date.now }),
  "POST /api/predictions": makePredictHandler({ predictions, now: Date.now }),
  "POST /api/attempts": makeAttemptHandler({ reviews, predictions, queueReview, now: Date.now }),
  "GET /api/schedule": async () => json(200, await reviews.overview()),
  "GET /api/pending": async () => json(200, { submissions: await reviews.pending() }),
  "POST /api/uploads": uploadHandler,
  "POST /api/extension/pair": sync.pair,
  "GET /api/sync": sync.status,
  "POST /api/sync": sync.syncNow,
  "POST /api/reviews": ai.request,
  "GET /api/reviews": ai.list,
  "GET /api/budget": ai.budget,
  "GET /api/history": async () => json(200, { attempts: await reviews.history() }),
  "GET /api/stats": makeStatsHandler(dynamoStatsStore(table, process.env.SITE_BUCKET ?? "")),
});
