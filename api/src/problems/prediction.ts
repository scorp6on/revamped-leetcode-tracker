import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { Prediction } from "./types";

// After this long unclaimed, a prediction counts as abandoned and the page asks for a new one (#45, 6 h per #46).
export const PREDICTION_WINDOW_MS = 6 * 60 * 60 * 1000;

export const isActive = (p: Prediction, now: number) =>
  !p.claimed && now - Date.parse(p.createdAt) < PREDICTION_WINDOW_MS;

export interface PredictionStore {
  latest(problemId: string): Promise<Prediction | undefined>;
  save(p: Prediction): Promise<void>;
}

// Both Lambdas' IAM policies only allow keys starting with PROBLEM#.
export const dynamoPredictionStore = (tableName: string): PredictionStore => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return {
    async latest(problemId) {
      // Sort keys hold the time, so newest-first + Limit 1 is the latest prediction.
      const { Items } = await db.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: { ":pk": `PROBLEM#${problemId}`, ":sk": "PREDICTION#" },
          ScanIndexForward: false,
          Limit: 1,
        }),
      );
      const item = Items?.[0];
      return item && {
        problemId: item.problemId,
        slug: item.slug,
        text: item.text,
        createdAt: item.createdAt,
        claimed: item.claimed,
      };
    },
    async save(p) {
      await db.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: `PROBLEM#${p.problemId}`, SK: `PREDICTION#${p.createdAt}`, ...p },
        }),
      );
    },
  };
};
