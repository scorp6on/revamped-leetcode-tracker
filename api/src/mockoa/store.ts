import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import type { Catalog, CatalogEntry } from "../catalog/types";
import { INDEX } from "../review/store";
import type { ListEntry, PastSession, Session } from "./types";

// One field to change: its path in the session ("problems", 2, "code") and the new value.
export type Change = [path: (string | number)[], value: unknown];

export interface MockOaStore {
  get(id: string): Promise<Session | undefined>;
  create(session: Session): Promise<void>;
  // Applies the changes together; false if the test was already finished (when onlyIfRunning).
  update(id: string, changes: Change[], onlyIfRunning?: boolean): Promise<boolean>;
  past(): Promise<PastSession[]>; // newest first
  list(): Promise<ListEntry[]>;
  saveList(entries: ListEntry[]): Promise<void>;
  catalog(): Promise<CatalogEntry[]>;
  solved(): Promise<Set<string>>; // problem IDs you've solved at least once
  remove(id: string): Promise<boolean>; // false if it finished in the meantime
  removePrediction(problemId: string, createdAt: string): Promise<void>; // unless an attempt claimed it
}

const KEYS = ["PK", "SK", "GSI1PK", "GSI1SK"];
const key = (id: string) => ({ PK: `MOCKOA#${id}`, SK: "SESSION" });
const LIST_KEY = { PK: "MOCKLIST", SK: "LIST" };
const PAST_FIELDS = ["id", "createdAt", "deadline", "minutes", "source", "finishedAt", "summary", "count"];

// UpdateExpression parts for a set of changes; every name goes through #n, every value through :v.
export const updateExpression = (changes: Change[]) => {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = changes.map(([path, value], i) => {
    const parts = path.map((p) => {
      if (typeof p === "number") return `[${p}]`;
      const n = `#${p}`;
      names[n] = p;
      return `.${n}`;
    });
    values[`:v${i}`] = value;
    return `${parts.join("").replace(/^\./, "")} = :v${i}`;
  });
  return { UpdateExpression: `SET ${sets.join(", ")}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values };
};

// Mock OA data lives under MOCKOA#<id>, MOCKLIST and the MOCKOAS drawer only.
export const dynamoMockOaStore = (tableName: string, bucket: string): MockOaStore => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const s3 = new S3Client({});
  let catalog: CatalogEntry[] | undefined; // changes weekly at most; a warm Lambda keeps it

  const drawer = async (name: string, fields: string[], newestFirst = false) => {
    const items: Record<string, unknown>[] = [];
    let start: QueryCommandInput["ExclusiveStartKey"];
    do {
      const page = await db.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: INDEX,
          KeyConditionExpression: "GSI1PK = :d",
          ExpressionAttributeValues: { ":d": name },
          ProjectionExpression: fields.map((f) => `#${f}`).join(", "),
          ExpressionAttributeNames: Object.fromEntries(fields.map((f) => [`#${f}`, f])),
          ScanIndexForward: !newestFirst,
          ExclusiveStartKey: start,
        }),
      );
      items.push(...(page.Items ?? []));
      start = page.LastEvaluatedKey;
    } while (start);
    return items;
  };

  return {
    async get(id) {
      const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: key(id) }));
      if (!Item) return undefined;
      return Object.fromEntries(Object.entries(Item).filter(([k]) => !KEYS.includes(k))) as Session;
    },

    async create(session) {
      await db.send(
        new PutCommand({
          TableName: tableName,
          Item: { ...key(session.id), GSI1PK: "MOCKOAS", GSI1SK: session.createdAt, ...session },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
    },

    async update(id, changes, onlyIfRunning = false) {
      const expr = updateExpression(changes);
      try {
        await db.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key(id),
            ...expr,
            ...(onlyIfRunning && {
              ConditionExpression: "attribute_exists(PK) AND #finishedAt = :none",
              ExpressionAttributeNames: { ...expr.ExpressionAttributeNames, "#finishedAt": "finishedAt" },
              ExpressionAttributeValues: { ...expr.ExpressionAttributeValues, ":none": null },
            }),
          }),
        );
        return true;
      } catch (err) {
        if ((err as Error).name === "ConditionalCheckFailedException") return false;
        throw err;
      }
    },

    async past() {
      return (await drawer("MOCKOAS", PAST_FIELDS, true)) as unknown as PastSession[];
    },

    async list() {
      const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: LIST_KEY }));
      return (Item?.problems as ListEntry[] | undefined) ?? [];
    },

    async saveList(entries) {
      await db.send(new PutCommand({ TableName: tableName, Item: { ...LIST_KEY, problems: entries } }));
    },

    async catalog() {
      if (catalog) return catalog;
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "data/catalog.json" }));
      return (catalog = (JSON.parse(await res.Body!.transformToString()) as Catalog).problems);
    },

    async remove(id) {
      try {
        await db.send(
          new DeleteCommand({
            TableName: tableName,
            Key: key(id),
            ConditionExpression: "#finishedAt = :none",
            ExpressionAttributeNames: { "#finishedAt": "finishedAt" },
            ExpressionAttributeValues: { ":none": null },
          }),
        );
        return true;
      } catch (err) {
        if ((err as Error).name === "ConditionalCheckFailedException") return false;
        throw err;
      }
    },

    async removePrediction(problemId, createdAt) {
      try {
        await db.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: `PROBLEM#${problemId}`, SK: `PREDICTION#${createdAt}` },
            ConditionExpression: "#claimed = :no",
            ExpressionAttributeNames: { "#claimed": "claimed" },
            ExpressionAttributeValues: { ":no": false },
          }),
        );
      } catch (err) {
        if ((err as Error).name !== "ConditionalCheckFailedException") throw err;
      }
    },

    async solved() {
      const items = await drawer("DUE", ["problemId", "solved"]);
      return new Set(items.filter((s) => s.solved).map((s) => String(s.problemId)));
    },
  };
};
