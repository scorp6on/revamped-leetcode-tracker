import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { json } from "../http";
import { isLocalDate } from "../review/dates";
import { computeStats } from "./compute";
import type { StatsStore } from "./store";
import { RANGES, type Range } from "./types";

// GET /api/stats?range=12w&today=YYYY-MM-DD. The browser sends its local date, because the Lambda
// doesn't know your time zone.
export const makeStatsHandler =
  (store: StatsStore) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const q = event.queryStringParameters ?? {};
    const range = (RANGES as readonly string[]).includes(q.range ?? "") ? (q.range as Range) : "12w";
    if (!isLocalDate(q.today)) return json(400, { error: "today must be YYYY-MM-DD" });
    const [attempts, schedules, grades, catalog] = await Promise.all([
      store.attempts(),
      store.schedules(),
      store.grades(),
      store.catalog(),
    ]);
    return json(200, computeStats({ attempts, schedules, grades, catalog, range, today: q.today }));
  };
