import { describe, expect, it, vi } from "vitest";
import type { GetCommand, GetCommandOutput } from "@aws-sdk/lib-dynamodb";
import { HEALTH_KEY, makeHandler, type ItemReader } from "./health";

const reader = (result: () => Promise<Partial<GetCommandOutput>>) => {
  const calls: GetCommand[] = [];
  const db: ItemReader = {
    send: async (command) => {
      calls.push(command);
      return (await result()) as GetCommandOutput;
    },
  };
  return { db, calls };
};

const parse = (res: unknown) => {
  const r = res as { statusCode: number; body: string };
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

describe("health handler", () => {
  it("reports ok when the health item is readable", async () => {
    const { db, calls } = reader(async () => ({ Item: HEALTH_KEY }));
    const res = parse(await makeHandler(db, "tbl")());

    expect(res).toEqual({ status: 200, body: { ok: true, db: "read ok" } });
    expect(calls[0].input).toEqual({ TableName: "tbl", Key: HEALTH_KEY });
  });

  it("reports the item missing but still 200 when the read succeeds empty", async () => {
    const { db } = reader(async () => ({}));
    const res = parse(await makeHandler(db, "tbl")());

    expect(res).toEqual({ status: 200, body: { ok: true, db: "health item missing" } });
  });

  it("returns 503 when DynamoDB is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = reader(async () => {
      throw new Error("boom");
    });
    const res = parse(await makeHandler(db, "tbl")());

    expect(res).toEqual({ status: 503, body: { ok: false, db: "unreachable" } });
  });
});
