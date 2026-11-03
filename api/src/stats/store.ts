import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import type { Catalog } from "../catalog/types";
import { INDEX } from "../review/store";
import type { CatalogSummary, PredictionGrade, StatsAttempt, StatsMockOa, StatsSchedule } from "./types";

// Reads only the attributes listed, each through a #name (some, like "minutes", are reserved words).
const projection = (fields: string[]) => ({
  ProjectionExpression: fields.map((f) => f.split(".").map((p) => `#${p}`).join(".")).join(", "),
  ExpressionAttributeNames: Object.fromEntries(fields.flatMap((f) => f.split(".")).map((p) => [`#${p}`, p])),
});

export const dynamoStatsStore = (tableName: string, bucket: string) => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});

  const drawer = async (name: string, fields: string[]) => {
    const items: Record<string, unknown>[] = [];
    let start: QueryCommandInput["ExclusiveStartKey"];
    do {
      const page = await db.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: INDEX,
          KeyConditionExpression: "GSI1PK = :d",
          ExpressionAttributeValues: { ":d": name },
          ExclusiveStartKey: start,
          ...projection(fields),
        }),
      );
      items.push(...(page.Items ?? []));
      start = page.LastEvaluatedKey;
    } while (start);
    return items;
  };

  // The catalog changes weekly at most, so a warm Lambda keeps its summary.
  let catalog: CatalogSummary | undefined;

  return {
    // Never notes or code (#59 C).
    async attempts(): Promise<StatsAttempt[]> {
      const items = await drawer("ATTEMPTS", [
        "problemId", "createdAt", "localDate", "outcome", "minutes", "failureMode", "difficulty", "quality", "prediction",
      ]);
      return items.map(({ prediction, ...a }) => ({ ...(a as Omit<StatsAttempt, "predicted">), predicted: !!prediction }));
    },

    async schedules(): Promise<StatsSchedule[]> {
      return (await drawer("DUE", ["problemId", "due", "tags", "attempts"])) as unknown as StatsSchedule[];
    },

    // Finished reviews only, and only the label; "none" means no prediction was made.
    async grades(): Promise<PredictionGrade[]> {
      const items = await drawer("AIREVIEWS", ["PK", "attemptCreatedAt", "status", "review.predictionLabel"]);
      return items.flatMap((r) => {
        const label = (r.review as { predictionLabel?: string } | undefined)?.predictionLabel;
        if (r.status !== "done" || (label !== "correct" && label !== "partial" && label !== "wrong")) return [];
        return [{ problemId: String(r.PK).slice("PROBLEM#".length), attemptCreatedAt: String(r.attemptCreatedAt), label }];
      });
    },

    // Finished mock OAs only; one still running or canceled isn't a score.
    async mockOas(): Promise<StatsMockOa[]> {
      const items = await drawer("MOCKOAS", ["createdAt", "minutes", "count", "summary", "finishedAt"]);
      return items
        .filter((m) => m.finishedAt && m.summary)
        .map((m) => ({ createdAt: m.createdAt, minutes: m.minutes, count: m.count, summary: m.summary })) as StatsMockOa[];
    },

    async catalog(): Promise<CatalogSummary> {
      if (catalog) return catalog;
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "data/catalog.json" }));
      const { tags, problems } = JSON.parse(await res.Body!.transformToString()) as Catalog;
      const counts: Record<string, number> = {};
      for (const p of problems) for (const t of p.tags) counts[t] = (counts[t] ?? 0) + 1;
      return (catalog = { names: tags, counts });
    },
  };
};

export type StatsStore = ReturnType<typeof dynamoStatsStore>;
