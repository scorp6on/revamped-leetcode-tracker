import Anthropic from "@anthropic-ai/sdk";
import { LambdaClient } from "@aws-sdk/client-lambda";
import type { SQSEvent } from "aws-lambda";
import { dynamoAiStore } from "./ai/store";
import { getSecret } from "./auth/secrets";
import { fetchQuestion } from "./mockoa/leetcode";
import { lambdaRunCode } from "./mockoa/runner";
import { dynamoMockOaStore, type MockOaStore } from "./mockoa/store";
import {
  makeTestWriterWork,
  WRITER_SCHEMA,
  type ClaudeAnswer,
  type WriterMessage,
  type WriterModel,
  type WrittenTests,
} from "./mockoa/writer";

const MAX_TRIES = 2; // matches the queue's maxReceiveCount

// The answer's shape is fixed by the schema, but a cut-off or odd answer is checked anyway.
const isWritten = (x: unknown): x is WrittenTests => {
  const w = x as WrittenTests;
  return (
    !!w &&
    typeof w.reference === "string" &&
    Array.isArray(w.tests) &&
    w.tests.every((t) => typeof t?.input === "string") &&
    Array.isArray(w.large) &&
    w.large.every((t) => typeof t?.generator === "string")
  );
};

// One model call with structured output (#63 D). Haiku 5.5 has no server-side fallback, so the
// Test writer moves on to Sonnet 5.5 itself when this answer fails the check.
export const makeWriterClaude = (apiKey: string) => {
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  return async (model: WriterModel, system: string, user: string): Promise<ClaudeAnswer> => {
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: WRITER_SCHEMA } },
      system,
      messages: [{ role: "user", content: user }],
    });
    const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };
    if (res.stop_reason === "refusal") return { kind: "refused", usage };
    const text = res.content.find((b) => b.type === "text");
    if (res.stop_reason === "max_tokens" || !text || text.type !== "text") return { kind: "invalid", usage };
    try {
      const data = JSON.parse(text.text);
      return isWritten(data) ? { kind: "ok", data, usage } : { kind: "invalid", usage };
    } catch {
      return { kind: "invalid", usage };
    }
  };
};

export const makeTestWriterHandler =
  (store: Pick<MockOaStore, "testSet" | "saveTestSet">, work: (m: WriterMessage) => Promise<void>, now: () => number) =>
  async (event: SQSEvent): Promise<void> => {
    for (const record of event.Records) {
      const message = JSON.parse(record.body) as WriterMessage;
      try {
        await work(message);
      } catch (err) {
        console.error("test writing failed", message, err);
        // Last try: the problem runs on examples for now and is tried again next time it's used.
        if (Number(record.attributes.ApproximateReceiveCount) >= MAX_TRIES && !(await store.testSet(message.problemId))) {
          await store.saveTestSet({
            problemId: message.problemId,
            status: "limited",
            reason: "Writing tests failed",
            reference: null,
            tests: [],
            flagged: [],
            model: null,
            writtenAt: new Date(now()).toISOString(),
            costUsd: 0,
          });
        }
        throw err; // to the dead-letter queue after the last try
      }
    }
  };

const table = process.env.TABLE_NAME ?? "";
const store = dynamoMockOaStore(table, "");
const ai = dynamoAiStore(table);

export const handler = makeTestWriterHandler(
  store,
  makeTestWriterWork({
    store,
    budget: { spent: (m) => ai.spent(m), addSpend: (m, usd) => ai.addSpend(m, usd) },
    fetchQuestion,
    claude: async (model, system, user) => makeWriterClaude(await getSecret("anthropic-api-key"))(model, system, user),
    runCode: lambdaRunCode(new LambdaClient({}), process.env.RUNNER_FN),
    capUsd: Number(process.env.BUDGET_CAP ?? 0),
    now: Date.now,
  }),
  Date.now,
);
