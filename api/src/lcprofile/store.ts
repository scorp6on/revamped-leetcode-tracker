import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { LeetCodeProfile } from "./types";

const KEY = { PK: "LCPROFILE", SK: "PROFILE" };

export interface LcProfileStore {
  saved(): Promise<LeetCodeProfile | undefined>;
  save(p: LeetCodeProfile): Promise<void>;
}

export const dynamoLcProfileStore = (tableName: string): LcProfileStore => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return {
    async saved() {
      const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: KEY }));
      return Item && (Object.fromEntries(Object.entries(Item).filter(([k]) => k !== "PK" && k !== "SK")) as LeetCodeProfile);
    },
    async save(p) {
      await db.send(new PutCommand({ TableName: tableName, Item: { ...KEY, ...p } }));
    },
  };
};
