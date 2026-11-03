// The Test writer (#17, #32, #63): the AI writes a reference solution and test inputs, the Code runner
// checks them, and the reference's answers become the expected outputs. Never the model's own outputs.
import { monthOf } from "../ai/types";
import { buildJudgeProblem, type JudgeProblem, type RawQuestion } from "./leetcode";
import type { RunCode } from "./routes";
import type { MockOaStore } from "./store";
import { NEUTRAL_CLASS, NEUTRAL_FUNCTION, TIME_LIMIT_MS, type AiTest, type TestSet } from "./types";

export const MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"] as const; // #32: Haiku first, Sonnet if it fails
export type WriterModel = (typeof MODELS)[number];
export const MIN_GOOD_TESTS = 8; // fewer checked tests than this and the batch failed (#63 B)
export const SMALL_TESTS = 15;
export const LARGE_TESTS = 3;

// $ per token (claude-api reference, Nov 2026). Haiku's rate applies to prompts up to 100K tokens,
// which these always are. An estimate: the Console's spend limit is the hard stop (#58).
const PRICES: Record<WriterModel, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1 / 1e6, output: 0.5 / 1e6 },
  "claude-sonnet-5-5": { input: 2 / 1e6, output: 10 / 1e6 },
};
export const costFor = (model: WriterModel, u: { input_tokens: number; output_tokens: number }) =>
  u.input_tokens * PRICES[model].input + u.output_tokens * PRICES[model].output;

export interface WrittenTests {
  reference: string;
  tests: { input: string }[];
  large: { generator: string }[];
}

export const WRITER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reference", "tests", "large"],
  properties: {
    reference: { type: "string", description: "A correct, efficient Python 3 solution using the given class and method names" },
    tests: {
      type: "array",
      description: `${SMALL_TESTS} small tests`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["input"],
        properties: { input: { type: "string", description: "One JSON value per line, one line per argument, LeetCode's format" } },
      },
    },
    large: {
      type: "array",
      description: `${LARGE_TESTS} large tests`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["generator"],
        properties: { generator: { type: "string", description: "Python defining make() that returns the list of arguments" } },
      },
    },
  },
} as const;

export const SYSTEM = `You write test cases for a coding-interview practice app. Another program runs your reference
solution on every input you write, and its answers become the expected outputs, so you never write outputs.

Rules:
- The reference must be correct and efficient (the intended complexity, not brute force). It must use exactly
  the class and method names in the starter code. Python 3 standard library only; ListNode and TreeNode exist.
- Every input must satisfy the problem's constraints exactly. An input that breaks a constraint is a bug.
- Small tests: cover edge cases (smallest sizes, duplicates, negatives, empty where allowed, boundaries, ties)
  and ordinary cases. Write each as LeetCode does: one JSON value per line, one line per argument, in order.
  Linked lists and trees are JSON lists in level order with null for missing children.
- Large tests: Python code defining make() with no arguments that returns a list with one value per argument,
  using the random module (already seeded; do not seed it). Make inputs near the maximum sizes in the
  constraints, so a brute-force solution is too slow. Return plain lists, numbers, strings and booleans.
- Design problems (a class with methods): each input is two lines, the list of calls (the first is the class
  name) and the list of argument lists. Large tests return [calls, args] the same way.`;

const text = (html: string) =>
  html
    .replace(/<sup>(.*?)<\/sup>/g, "^$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&(quot|#39|lt|gt|nbsp|amp);/g, (m) => ({ "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&amp;": "&" })[m]!)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const buildWriterPrompt = (p: JudgeProblem) =>
  [
    `Problem statement:\n${text(p.statement)}`,
    `Starter code (keep these names):\n${p.stub}`,
    p.spec.kind === "design"
      ? `This is a design problem: the class is ${NEUTRAL_CLASS}.`
      : `Arguments, in order: ${p.spec.paramNames.map((n, i) => `${n} (${p.spec.params[i]})`).join(", ")}. Method: ${NEUTRAL_FUNCTION}.`,
    `The problem's own examples, as inputs:\n${p.tests.map((t) => t.input).join("\n---\n")}`,
    `Write the reference, ${SMALL_TESTS} small tests and ${LARGE_TESTS} large tests.`,
  ].join("\n\n");

export type ClaudeAnswer = { kind: "ok"; data: WrittenTests; usage: { input_tokens: number; output_tokens: number } } | { kind: "refused" | "invalid"; usage: { input_tokens: number; output_tokens: number } };

export interface WriterMessage {
  problemId: string;
  slug: string;
  rewrite?: boolean; // Rewrite tests on the problem page: replace a full set too
}

export interface WriterDeps {
  store: Pick<MockOaStore, "testSet" | "saveTestSet">;
  budget: { spent(month: string): Promise<number>; addSpend(month: string, usd: number): Promise<void> };
  fetchQuestion: (slug: string) => Promise<RawQuestion | null>;
  claude: (model: WriterModel, system: string, user: string) => Promise<ClaudeAnswer>;
  runCode: RunCode;
  capUsd: number;
  now: () => number;
}

// Runs the reference on the examples (must all match) and on the AI's inputs (keeps those it handles).
export const checkTests = async (p: JudgeProblem, written: WrittenTests, runCode: RunCode): Promise<AiTest[] | null> => {
  const ai: AiTest[] = [
    ...written.tests.slice(0, SMALL_TESTS).map((t, i): AiTest => ({ id: `t${i + 1}`, input: t.input.trim(), large: false })),
    ...written.large.slice(0, LARGE_TESTS).map((t, i): AiTest => ({ id: `L${i + 1}`, generator: t.generator, seed: i + 1, large: true })),
  ];
  const out = await runCode({
    code: null,
    reference: written.reference,
    kind: p.spec.kind,
    entry: p.spec.kind === "design" ? NEUTRAL_CLASS : NEUTRAL_FUNCTION,
    params: p.spec.params,
    returnType: p.spec.returnType,
    outputParam: p.spec.outputParam,
    design: p.spec.design,
    anyOrder: p.spec.anyOrder,
    timeLimitMs: TIME_LIMIT_MS,
    tests: [...p.tests, ...ai.map(({ input, generator, seed }) => (generator ? { generator, seed } : { input }))],
  });
  if (out.compileError) return null;
  const examples = out.results.slice(0, p.tests.length);
  if (examples.some((r) => r.status !== "passed")) return null; // a wrong reference: throw the batch away
  const good = ai.filter((_, i) => out.results[p.tests.length + i]?.status === "passed");
  return good.length >= MIN_GOOD_TESTS ? good : null;
};

export const makeTestWriterWork = ({ store, budget, fetchQuestion, claude, runCode, capUsd, now }: WriterDeps) =>
  async ({ problemId, slug, rewrite = false }: WriterMessage): Promise<void> => {
    const existing = await store.testSet(problemId);
    // Queues can deliver twice: a full set is never paid for again unless you asked for a rewrite.
    if (existing?.status === "full" && !rewrite) return;
    if (existing && rewrite && Date.parse(existing.writtenAt) > now() - 60_000) return; // a duplicate rewrite

    const at = () => new Date(now()).toISOString();
    // No usable tests this time. A failed rewrite keeps the old full set rather than losing it.
    const limited = (reason: string, costUsd = 0): TestSet =>
      existing?.status === "full"
        ? { ...existing, reason, writtenAt: at(), costUsd: existing.costUsd + costUsd }
        : { problemId, status: "limited", reason, reference: null, tests: [], flagged: [], model: null, writtenAt: at(), costUsd };

    const month = monthOf(now());
    if ((await budget.spent(month)) >= capUsd) return store.saveTestSet(limited("The monthly AI budget is used up"));

    const q = await fetchQuestion(slug);
    const problem = q ? buildJudgeProblem(q) : "not found on LeetCode";
    if (typeof problem === "string") return store.saveTestSet(limited(`Can't be judged here: ${problem}`));

    const user = buildWriterPrompt(problem);
    let spent = 0;
    for (const model of MODELS) {
      const answer = await claude(model, SYSTEM, user);
      const cost = costFor(model, answer.usage);
      spent += cost;
      await budget.addSpend(month, cost);
      if (answer.kind !== "ok") continue;
      const good = await checkTests(problem, answer.data, runCode).catch((err) => {
        console.error("checking tests failed", problemId, model, err);
        return null;
      });
      if (!good) continue;
      return store.saveTestSet({
        problemId,
        status: "full",
        reference: answer.data.reference,
        tests: good,
        flagged: [], // a rewrite clears old flags (#63)
        model,
        writtenAt: at(),
        costUsd: spent,
      });
    }
    await store.saveTestSet(limited("The AI's tests didn't pass the check", spent));
  };
