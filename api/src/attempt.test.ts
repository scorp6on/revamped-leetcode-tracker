import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { makeApiHandler } from "./api";
import { makeAttemptHandler } from "./attempt";
import { PREDICTION_WINDOW_MS } from "./problems/prediction";
import type { Prediction } from "./problems/types";
import type { ReviewStore } from "./review/store";
import type { ReviewMessage } from "./ai/types";
import type { Schedule } from "./review/types";
import type { Submission } from "./sync/types";

const NOW = Date.parse("2026-10-28T20:00:00Z");

const valid = {
  problemId: "1",
  slug: "two-sum",
  title: "Two Sum",
  difficulty: "Easy",
  tags: ["array", "hash-table"],
  outcome: "solved",
  confidence: 4,
  minutes: 12,
  failureMode: null,
  approach: "  **hash map** of seen values  ",
  learned: "complement lookup",
  reflection: "",
  localDate: "2026-10-28",
};

const prediction = (ageMs: number, claimed = false): Prediction => ({
  problemId: "1",
  slug: "two-sum",
  text: "hash map of seen values",
  createdAt: new Date(NOW - ageMs).toISOString(),
  claimed,
});

const setup = ({ current, latest, waiting = [], queueFails = false }: { current?: Schedule; latest?: Prediction; waiting?: Submission[]; queueFails?: boolean } = {}) => {
  const queued: ReviewMessage[] = [];
  const recorded: Parameters<ReviewStore["record"]>[0][] = [];
  const handler = makeAttemptHandler({
    reviews: { schedule: async () => current, pendingFor: async () => waiting, record: async (c) => void recorded.push(c) },
    predictions: { latest: async () => latest },
    queueReview: async (m) => {
      if (queueFails) throw new Error("SQS down");
      queued.push(m);
    },
    now: () => NOW,
  });
  const post = async (body: unknown) => {
    const res = (await handler({ body: JSON.stringify(body) } as APIGatewayProxyEventV2)) as {
      statusCode: number;
      body: string;
    };
    return { statusCode: res.statusCode, body: JSON.parse(res.body) };
  };
  return { post, recorded, queued };
};

describe("POST /api/attempts", () => {
  it("records a first solve: due tomorrow, attempt + schedule saved together", async () => {
    const { post, recorded } = setup();
    const res = await post(valid);

    expect(res.statusCode).toBe(201);
    expect(recorded).toHaveLength(1);
    const { attempt, schedule, claim } = recorded[0];
    expect(attempt).toMatchObject({
      outcome: "solved", quality: 4, prediction: null,
      approach: "**hash map** of seen values", learned: "complement lookup", reflection: "",
    });
    expect(attempt.createdAt).toBe("2026-10-28T20:00:00.000Z");
    expect(schedule).toMatchObject({ due: "2026-10-29", intervalDays: 1, repetitions: 1, attempts: 1, solved: true });
    expect(claim).toBeUndefined();
  });

  it("uses your local date, not the server's UTC date, for the due date", async () => {
    // 20:00 UTC on the 28th is already the 29th in Tokyo.
    const { post, recorded } = setup();
    await post({ ...valid, localDate: "2026-10-29" });
    expect(recorded[0].schedule.due).toBe("2026-10-30");
  });

  it("moves an existing schedule up the ladder and counts failure modes", async () => {
    const current: Schedule = {
      problemId: "1", slug: "two-sum", title: "Two Sum", difficulty: "Easy", tags: ["array"],
      ease: 2.5, intervalDays: 1, repetitions: 1, due: "2026-10-28",
      attempts: 1, solved: false, failureModes: { "off-by-one": 1 }, lastAttemptAt: "2026-10-27T10:00:00.000Z",
    };
    const { post, recorded } = setup({ current });
    await post({ ...valid, failureMode: "off-by-one" });
    expect(recorded[0].schedule).toMatchObject({
      due: "2026-11-03", intervalDays: 6, repetitions: 2, attempts: 2, solved: true,
      failureModes: { "off-by-one": 2 },
    });
  });

  it("schedules a shaky solve for tomorrow (#47)", async () => {
    const { post, recorded } = setup();
    await post({ ...valid, confidence: 2 });
    expect(recorded[0].attempt.quality).toBe(2);
    expect(recorded[0].schedule).toMatchObject({ due: "2026-10-29", repetitions: 0, solved: true });
  });

  it("claims an unclaimed prediction from the last 6 hours, and copies its text", async () => {
    const latest = prediction(PREDICTION_WINDOW_MS - 60_000);
    const { post, recorded } = setup({ latest });
    await post(valid);
    expect(recorded[0].claim).toEqual(latest);
    expect(recorded[0].attempt.prediction).toBe(latest.text);
  });

  it("leaves old or already-claimed predictions alone", async () => {
    for (const latest of [prediction(PREDICTION_WINDOW_MS), prediction(1000, true)]) {
      const { post, recorded } = setup({ latest });
      await post(valid);
      expect(recorded[0].claim).toBeUndefined();
      expect(recorded[0].attempt.prediction).toBeNull();
    }
  });

  it("requires a failure mode when you struggled or failed", async () => {
    const { post, recorded } = setup();
    expect((await post({ ...valid, outcome: "struggled" })).statusCode).toBe(400);
    expect((await post({ ...valid, outcome: "failed", failureMode: "wrong-approach" })).statusCode).toBe(201);
    expect(recorded).toHaveLength(1);
  });

  it("rejects bad input", async () => {
    const { post, recorded } = setup();
    const bad = [
      { outcome: "aced" },
      { confidence: 0 },
      { confidence: 3.5 },
      { minutes: 0 },
      { minutes: 601 },
      { failureMode: "bad-luck" },
      { localDate: "2026-02-30" },
      { approach: "x".repeat(5001) },
      { learned: "x".repeat(5001) },
      { reflection: 42 },
      { tags: ["Not A Slug"] },
      { difficulty: "Extreme" },
      { problemId: "1#SK" },
    ];
    for (const patch of bad) expect((await post({ ...valid, ...patch })).statusCode, JSON.stringify(patch)).toBe(400);
    expect(recorded).toHaveLength(0);
  });
});

describe("queueing the AI review (#58)", () => {
  it("queues a review for the saved attempt", async () => {
    const { post, queued, recorded } = setup();
    await post(valid);
    expect(queued).toEqual([{ problemId: "1", createdAt: recorded[0].attempt.createdAt }]);
    expect(recorded[0].attempt.reviewQueuedAt).toBe(new Date(NOW).toISOString());
  });

  it("still saves the grade when the queue is down", async () => {
    const { post, recorded } = setup({ queueFails: true });
    expect((await post(valid)).statusCode).toBe(201);
    expect(recorded).toHaveLength(1);
  });
});

describe("grading synced submissions (#57)", () => {
  const HOUR = 3600_000;
  const sub = (id: string, at: number, extra: Partial<Submission> = {}): Submission => ({
    id, slug: "two-sum", title: "Two Sum", status: "Accepted", accepted: true, lang: "python3",
    runtime: null, memory: null, timestamp: Math.floor(at / 1000), code: `code ${id}`, source: "extension", ...extra,
  });

  it("turns everything waiting into one attempt, dated by the last submission, and clears it", async () => {
    const waiting = [sub("1", NOW - 30 * HOUR, { accepted: false }), sub("2", NOW - 29 * HOUR), sub("3", NOW - 28 * HOUR, { accepted: false })];
    const { post, recorded } = setup({ waiting });
    expect((await post({ ...valid, localDate: "2026-10-27" })).statusCode).toBe(201);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].submissionIds).toEqual(["1", "2", "3"]);
    expect(recorded[0].attempt.createdAt).toBe(new Date(NOW - 28 * HOUR).toISOString());
    expect(recorded[0].attempt.code).toBe("code 2"); // the accepted one, not the newest
    expect(recorded[0].schedule.due).toBe("2026-10-28"); // counted from the day you solved
  });

  it("claims a prediction made within 6 hours before the first submission, even a day later", async () => {
    const latest = prediction(26 * HOUR);
    const { post, recorded } = setup({ latest, waiting: [sub("1", NOW - 25 * HOUR)] });
    await post(valid);
    expect(recorded[0].claim).toEqual(latest);
  });

  it("doesn't claim a prediction made after you submitted, or long before", async () => {
    for (const latest of [prediction(HOUR), prediction(40 * HOUR)]) {
      const { post, recorded } = setup({ latest, waiting: [sub("1", NOW - 25 * HOUR)] });
      await post(valid);
      expect(recorded[0].claim).toBeUndefined();
    }
  });

  it("keeps the code empty when only the backup poll saw it", async () => {
    const { post, recorded } = setup({ waiting: [sub("1", NOW, { code: null, source: "public" })] });
    await post(valid);
    expect(recorded[0].attempt.code).toBeNull();
  });

  it("leaves a manual attempt with nothing waiting as it was", async () => {
    const { post, recorded } = setup();
    await post(valid);
    expect(recorded[0].submissionIds).toBeUndefined();
    expect(recorded[0].attempt.createdAt).toBe(new Date(NOW).toISOString());
  });
});

describe("API router", () => {
  it("dispatches by route key and answers 404 for unknown routes", async () => {
    const handler = makeApiHandler({ "GET /api/me": async () => ({ statusCode: 200, body: "{}" }) });
    const call = (routeKey: string) => handler({ routeKey } as APIGatewayProxyEventV2) as Promise<{ statusCode: number }>;
    expect((await call("GET /api/me")).statusCode).toBe(200);
    expect((await call("GET /api/nope")).statusCode).toBe(404);
  });
});
