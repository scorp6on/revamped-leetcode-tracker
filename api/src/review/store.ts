import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { Prediction } from "../problems/types";
import type { Attempt, RecentFailure, Schedule, ScheduleResponse } from "./types";

// GSI1 is one overloaded index with two "drawers": ATTEMPTS (by time) and DUE (by due date).
export const INDEX = "GSI1";
const RECENT_ATTEMPTS = 50;

export interface ReviewStore {
  schedule(problemId: string): Promise<Schedule | undefined>;
  attempts(problemId: string): Promise<Attempt[]>; // newest first
  // All three writes land together or not at all.
  record(change: { attempt: Attempt; schedule: Schedule; claim?: Prediction }): Promise<void>;
  overview(): Promise<ScheduleResponse>;
}

// Drop the key attributes, so callers only see the shape in types.ts.
const KEYS = ["PK", "SK", "GSI1PK", "GSI1SK"];
const strip = <T>(item: Record<string, unknown>): T =>
  Object.fromEntries(Object.entries(item).filter(([k]) => !KEYS.includes(k))) as T;

export const dynamoReviewStore = (tableName: string): ReviewStore => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const queryAll = async (input: QueryCommandInput) => {
    const items: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await db.send(new QueryCommand({ ...input, ExclusiveStartKey: start }));
      items.push(...(page.Items ?? []));
      start = page.LastEvaluatedKey;
    } while (start);
    return items;
  };

  return {
    async schedule(problemId) {
      const { Item } = await db.send(
        new GetCommand({ TableName: tableName, Key: { PK: `PROBLEM#${problemId}`, SK: "SCHEDULE" } }),
      );
      return Item && strip<Schedule>(Item);
    },

    async attempts(problemId) {
      const items = await queryAll({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `PROBLEM#${problemId}`, ":sk": "ATTEMPT#" },
        ScanIndexForward: false, // sort keys hold the time, so this is newest first
      });
      return items.map((a) => strip<Attempt>(a));
    },

    async record({ attempt, schedule, claim }) {
      const pk = `PROBLEM#${attempt.problemId}`;
      await db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName,
                Item: { PK: pk, SK: `ATTEMPT#${attempt.createdAt}`, GSI1PK: "ATTEMPTS", GSI1SK: attempt.createdAt, ...attempt },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: { PK: pk, SK: "SCHEDULE", GSI1PK: "DUE", GSI1SK: schedule.due, ...schedule },
              },
            },
            ...(claim
              ? [
                  {
                    Update: {
                      TableName: tableName,
                      Key: { PK: pk, SK: `PREDICTION#${claim.createdAt}` },
                      UpdateExpression: "SET claimed = :yes",
                      ConditionExpression: "claimed = :no",
                      ExpressionAttributeValues: { ":yes": true, ":no": false },
                    },
                  },
                ]
              : []),
          ],
        }),
      );
    },

    async overview() {
      const [schedules, recent] = await Promise.all([
        queryAll({
          TableName: tableName,
          IndexName: INDEX,
          KeyConditionExpression: "GSI1PK = :due",
          ExpressionAttributeValues: { ":due": "DUE" },
        }),
        db.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: INDEX,
            KeyConditionExpression: "GSI1PK = :attempts",
            ExpressionAttributeValues: { ":attempts": "ATTEMPTS" },
            ProjectionExpression: "failureMode, tags",
            ScanIndexForward: false, // newest first
            Limit: RECENT_ATTEMPTS,
          }),
        ),
      ]);
      return {
        schedules: schedules.map((s) => strip<Schedule>(s)),
        recentFailures: (recent.Items ?? []).filter((a) => a.failureMode) as RecentFailure[],
      };
    },
  };
};
