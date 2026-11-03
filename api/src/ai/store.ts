import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Attempt } from "../review/types";
import type { AiReview } from "./types";

export interface AiStore {
  attempt(problemId: string, createdAt: string): Promise<Attempt | undefined>;
  review(problemId: string, createdAt: string): Promise<AiReview | undefined>;
  saveReview(problemId: string, review: AiReview): Promise<void>;
  spent(month: string): Promise<number>;
  addSpend(month: string, usd: number): Promise<void>;
}

const budgetKey = (month: string) => ({ PK: `BUDGET#${month}`, SK: "BUDGET" });

export const dynamoAiStore = (tableName: string): AiStore => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return {
    async attempt(problemId, createdAt) {
      const { Item } = await db.send(
        new GetCommand({ TableName: tableName, Key: { PK: `PROBLEM#${problemId}`, SK: `ATTEMPT#${createdAt}` } }),
      );
      return Item as Attempt | undefined;
    },
    async review(problemId, createdAt) {
      const { Item } = await db.send(
        new GetCommand({ TableName: tableName, Key: { PK: `PROBLEM#${problemId}`, SK: `AIREVIEW#${createdAt}` } }),
      );
      return Item as AiReview | undefined;
    },
    async saveReview(problemId, review) {
      await db
        .send(
          new PutCommand({
            TableName: tableName,
            // Also filed in the AIREVIEWS drawer of GSI1, so Stats finds every grade in one query (#59).
            Item: {
              PK: `PROBLEM#${problemId}`,
              SK: `AIREVIEW#${review.attemptCreatedAt}`,
              GSI1PK: "AIREVIEWS",
              GSI1SK: review.createdAt,
              ...review,
            },
            // A finished review is never overwritten; a failed or skipped one can be.
            ConditionExpression: "attribute_not_exists(PK) OR #status <> :done",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":done": "done" },
          }),
        )
        .catch((err: Error) => {
          if (err.name !== "ConditionalCheckFailedException") throw err;
        });
    },
    async spent(month) {
      const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: budgetKey(month) }));
      return (Item?.spentUsd as number | undefined) ?? 0;
    },
    async addSpend(month, usd) {
      await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: budgetKey(month),
          UpdateExpression: "ADD spentUsd :usd",
          ExpressionAttributeValues: { ":usd": usd },
        }),
      );
    },
  };
};
