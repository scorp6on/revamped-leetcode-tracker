import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

export interface LockoutState {
  failures: number;
  lockedUntil: number; // epoch ms; 0 when not locked
}

export interface LockoutStore {
  get(): Promise<LockoutState>;
  save(state: LockoutState): Promise<void>;
}

export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

// One item shared by every device. The login Lambda's IAM policy only allows keys starting with AUTH.
const KEY = { PK: "AUTH", SK: "LOCKOUT" };

export const dynamoLockoutStore = (tableName: string): LockoutStore => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return {
    async get() {
      const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: KEY }));
      return { failures: Item?.failures ?? 0, lockedUntil: Item?.lockedUntil ?? 0 };
    },
    async save(state) {
      await db.send(new PutCommand({ TableName: tableName, Item: { ...KEY, ...state } }));
    },
  };
};
