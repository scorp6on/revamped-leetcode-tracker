// Files AI reviews saved before M9 in the AIREVIEWS drawer of GSI1, so Stats can count their
// prediction grades (#59). New reviews are filed when they're saved. Safe to run more than once.
//
//   $env:AWS_PROFILE="leettracker"; npm run backfill-review-drawer -w infra -- dev
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const stage = process.argv[2];
if (stage !== "dev" && stage !== "prod") {
  console.error("usage: npm run backfill-review-drawer -w infra -- <dev|prod>");
  process.exit(1);
}

const main = async () => {
  const client = new DynamoDBClient({});
  const db = DynamoDBDocumentClient.from(client);

  // CDK names the table LeetTracker-<stage>-Table<random>.
  const { TableNames = [] } = await client.send(new ListTablesCommand({}));
  const tables = TableNames.filter((t) => t.startsWith(`LeetTracker-${stage}-Table`));
  if (tables.length !== 1) throw new Error(`expected one LeetTracker-${stage} table, found ${tables.length}`);
  const table = tables[0];

  let filed = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const page = await db.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "begins_with(SK, :r) AND attribute_not_exists(GSI1PK)",
        ExpressionAttributeValues: { ":r": "AIREVIEW#" },
        ProjectionExpression: "PK, SK, createdAt",
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) {
      await db.send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: "SET GSI1PK = :d, GSI1SK = :at",
          ExpressionAttributeValues: { ":d": "AIREVIEWS", ":at": item.createdAt },
        }),
      );
      filed++;
    }
    start = page.LastEvaluatedKey;
  } while (start);

  console.log(`✔ filed ${filed} review${filed === 1 ? "" : "s"} in ${table}`);
};

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
