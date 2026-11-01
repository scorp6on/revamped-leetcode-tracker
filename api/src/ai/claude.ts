import Anthropic from "@anthropic-ai/sdk";
import { REVIEW_SCHEMA, SYSTEM } from "./prompt";
import type { ReviewBody } from "./types";

export const MODEL = "claude-sonnet-5-5"; // #31

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export type ClaudeResult = { kind: "review"; review: ReviewBody; usage: Usage } | { kind: "refused"; usage: Usage };

// Sonnet 5.5 prices, $ per token. The counter is an estimate: a fallback model can bill differently,
// so the Console's spend limit is the hard stop (#58).
const PRICE = { input: 2 / 1e6, output: 10 / 1e6, cacheRead: 0.2 / 1e6, cacheWrite: 2.5 / 1e6 };

export const costOf = (u: Usage) =>
  u.input_tokens * PRICE.input +
  u.output_tokens * PRICE.output +
  (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
  (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite;

export const makeClaude = (apiKey: string) => {
  const client = new Anthropic({ apiKey, timeout: 100_000, maxRetries: 1 });
  return async (userMessage: string): Promise<ClaudeResult> => {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // if safety filters decline, retry on the model Anthropic recommends (#58)
      output_config: { effort: "medium", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    if (res.stop_reason === "refusal") return { kind: "refused", usage: res.usage };
    // A cut-off answer isn't valid JSON: this throws, and the queue tries again.
    if (res.stop_reason === "max_tokens") throw new Error("review was cut off at max_tokens");
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("review had no text");
    return { kind: "review", review: JSON.parse(text.text) as ReviewBody, usage: res.usage };
  };
};
