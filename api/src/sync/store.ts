import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { INDEX } from "../review/store";
import type { Submission, SyncState } from "./types";

const STATE_KEY = { PK: "SYNC", SK: "STATE" };

export interface SyncStore {
  state(): Promise<SyncState>;
  updateState(patch: Partial<SyncState>): Promise<void>;
  // Returns how many were new. Repeats are skipped, except that the extension's full copy fills
  // in a submission the backup poll saved first.
  saveSubmissions(subs: Submission[]): Promise<number>;
  pendingCount(): Promise<number>;
}

const isConditionFailure = (err: unknown) => (err as Error).name === "ConditionalCheckFailedException";

export const dynamoSyncStore = (tableName: string): SyncStore => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  return {
    async state() {
      const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: STATE_KEY }));
      return Object.fromEntries(Object.entries(Item ?? {}).filter(([k]) => k !== "PK" && k !== "SK")) as SyncState;
    },

    async updateState(patch) {
      const keys = Object.keys(patch) as (keyof SyncState)[];
      if (!keys.length) return;
      await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: STATE_KEY,
          UpdateExpression: `SET ${keys.map((k) => `#${k} = :${k}`).join(", ")}`,
          ExpressionAttributeNames: Object.fromEntries(keys.map((k) => [`#${k}`, k])),
          ExpressionAttributeValues: Object.fromEntries(keys.map((k) => [`:${k}`, patch[k] ?? null])),
        }),
      );
    },

    async saveSubmissions(subs) {
      let saved = 0;
      for (const s of subs) {
        try {
          // Written only if new: LeetCode's submission ID is the dedupe key (#10). The PENDING drawer
          // of GSI1 is where grading (M7) finds it.
          await db.send(
            new PutCommand({
              TableName: tableName,
              Item: { PK: `SUB#${s.id}`, SK: "SUB", GSI1PK: "PENDING", GSI1SK: new Date(s.timestamp * 1000).toISOString(), ...s },
              ConditionExpression: "attribute_not_exists(PK)",
            }),
          );
          saved += 1;
        } catch (err) {
          if (!isConditionFailure(err)) throw err;
          if (s.source !== "extension") continue;
          // Already there: if only the backup's bare copy, fill in the code and details.
          await db
            .send(
              new UpdateCommand({
                TableName: tableName,
                Key: { PK: `SUB#${s.id}`, SK: "SUB" },
                UpdateExpression: "SET #lang = :lang, runtime = :runtime, memory = :memory, code = :code, #source = :ext",
                ConditionExpression: "#source = :public",
                ExpressionAttributeNames: { "#lang": "lang", "#source": "source" },
                ExpressionAttributeValues: {
                  ":lang": s.lang,
                  ":runtime": s.runtime,
                  ":memory": s.memory,
                  ":code": s.code,
                  ":ext": "extension",
                  ":public": "public",
                },
              }),
            )
            .catch((e) => {
              if (!isConditionFailure(e)) throw e;
            });
        }
      }
      return saved;
    },

    async pendingCount() {
      let count = 0;
      let start: Record<string, unknown> | undefined;
      do {
        const page = await db.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: INDEX,
            KeyConditionExpression: "GSI1PK = :p",
            ExpressionAttributeValues: { ":p": "PENDING" },
            Select: "COUNT",
            ExclusiveStartKey: start,
          }),
        );
        count += page.Count ?? 0;
        start = page.LastEvaluatedKey;
      } while (start);
      return count;
    },
  };
};
