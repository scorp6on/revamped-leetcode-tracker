import { randomUUID } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { makeAiRoutes } from "./ai/routes";
import { dynamoAiStore } from "./ai/store";
import { monthOf, type ReviewMessage } from "./ai/types";
import { makeAttemptHandler } from "./attempt";
import { json } from "./http";
import { fetchLeetCodeProfile } from "./lcprofile/leetcode";
import { makeLcProfileHandler } from "./lcprofile/route";
import { dynamoLcProfileStore } from "./lcprofile/store";
import { fetchQuestion } from "./mockoa/leetcode";
import { makeMockOaRoutes } from "./mockoa/routes";
import { lambdaRunCode } from "./mockoa/runner";
import { dynamoMockOaStore } from "./mockoa/store";
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
const aiStore = dynamoAiStore(table);
const ai = makeAiRoutes({
  store: aiStore,
  reviews,
  enqueue: queueReview,
  capUsd: Number(process.env.BUDGET_CAP ?? 0),
  now: Date.now,
});
const runCode = lambdaRunCode(lambda, process.env.RUNNER_FN);
const mockOaStore = dynamoMockOaStore(table, process.env.SITE_BUCKET ?? "");
const mockOa = makeMockOaRoutes({
  store: mockOaStore,
  fetchQuestion,
  runCode,
  predictions,
  // The Test writer queue (#63): one message per problem that needs tests.
  enqueueTests: async (m) => {
    await sqs.send(new SendMessageCommand({ QueueUrl: process.env.TEST_QUEUE_URL, MessageBody: JSON.stringify(m) }));
  },
  budgetLeft: async () => (await aiStore.spent(monthOf(Date.now()))) < Number(process.env.BUDGET_CAP ?? 0),
  now: Date.now,
  random: Math.random,
  newId: randomUUID,
});
const syncStore = dynamoSyncStore(table);
const sync = makeSyncRoutes({
  store: syncStore,
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
  "POST /api/attempts": makeAttemptHandler({ reviews, predictions, queueReview, now: Date.now, mockOa: mockOaStore }),
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
  "GET /api/leetcode-profile": makeLcProfileHandler({
    username: async () => (await syncStore.state()).username,
    store: dynamoLcProfileStore(table),
    fetchProfile: fetchLeetCodeProfile,
    now: Date.now,
  }),
  "GET /api/stats": makeStatsHandler(dynamoStatsStore(table, process.env.SITE_BUCKET ?? "")),
  // Mock OA (#14, #17, #62).
  "GET /api/mockoa": mockOa.home,
  "POST /api/mockoa": mockOa.start,
  "PUT /api/mockoa/list": mockOa.saveList,
  "GET /api/mockoa/{id}": mockOa.get,
  "POST /api/mockoa/{id}/finish": mockOa.finish,
  "DELETE /api/mockoa/{id}": mockOa.cancel,
  "PUT /api/mockoa/{id}/problems/{index}": mockOa.save,
  "POST /api/mockoa/{id}/problems/{index}/approach": mockOa.approach,
  "POST /api/mockoa/{id}/problems/{index}/run": mockOa.run,
  "POST /api/mockoa/{id}/problems/{index}/flags": mockOa.flag,
  "GET /api/mock-tests/{problemId}": mockOa.testsInfo,
  "POST /api/mock-tests/{problemId}/unflag": mockOa.unflag,
  "POST /api/mock-tests/{problemId}/rewrite": mockOa.rewrite,
});
