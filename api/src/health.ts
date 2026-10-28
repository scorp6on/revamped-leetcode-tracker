import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, type GetCommandOutput } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { json } from "./http";

// The one item the infra stack seeds so we can prove a real DynamoDB read works.
export const HEALTH_KEY = { PK: "HEALTH", SK: "HEALTH" };

export interface ItemReader {
  send(command: GetCommand): Promise<GetCommandOutput>;
}

export const makeHandler =
  (db: ItemReader, tableName: string) => async (): Promise<APIGatewayProxyResultV2> => {
    try {
      const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: HEALTH_KEY }));
      return json(200, { ok: true, db: Item ? "read ok" : "health item missing" });
    } catch (err) {
      console.error("health check failed", err);
      return json(503, { ok: false, db: "unreachable" });
    }
  };

export const handler = makeHandler(
  DynamoDBDocumentClient.from(new DynamoDBClient({})),
  process.env.TABLE_NAME ?? "",
);
