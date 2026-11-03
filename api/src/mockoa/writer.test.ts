import { describe, expect, it } from "vitest";
import type { RawQuestion } from "./leetcode";
import type { RunCode } from "./routes";
import type { TestSet } from "./types";
import { buildWriterPrompt, costFor, makeTestWriterWork, type ClaudeAnswer, type WriterModel, type WrittenTests } from "./writer";
import { buildJudgeProblem } from "./leetcode";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");

const twoSum: RawQuestion = {
  id: "1",
  title: "Two Sum",
  slug: "two-sum",
  difficulty: "Easy",
  paid: false,
  category: "Algorithms",
  content: "<p>Find <code>twoSum</code>. 2 &lt;= nums.length &lt;= 10<sup>4</sup></p><p><strong>Output:</strong> <code>[0,1]</code></p>",
  examples: ["[2,7,11,15]\n9"],
  metaData: JSON.stringify({ name: "twoSum", params: [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }], return: { type: "integer[]" } }),
  tags: [{ slug: "array" }],
  snippets: [{ lang: "python3", code: "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n" }],
};

const written = (n = 15): WrittenTests => ({
  reference: "class Solution:\n    def solve(self, nums, target): ...",
  tests: Array.from({ length: n }, (_, i) => ({ input: `[${i},1]\n${i + 1}` })),
  large: [{ generator: "def make():\n    return [[1] * 10, 2]" }],
});

const usage = { input_tokens: 3000, output_tokens: 4000 };

// referenceOk: does the reference pass the examples? badInputs: AI test indexes the reference can't handle.
const setup = ({
  answers,
  referenceOk = [true, true],
  badInputs = [] as number[],
  spent = 0,
  existing,
}: {
  answers: ClaudeAnswer[];
  referenceOk?: boolean[];
  badInputs?: number[];
  spent?: number;
  existing?: TestSet;
}) => {
  const calls: WriterModel[] = [];
  const saved: TestSet[] = [];
  const spend: number[] = [];
  let check = 0;
  const runCode: RunCode = async (job) => {
    const ok = referenceOk[check++];
    const tests = job.tests as unknown[];
    return {
      compileError: null,
      results: tests.map((_, i) => ({ status: i === 0 ? (ok ? "passed" : "wrong") : badInputs.includes(i - 1) ? "invalid" : "passed" })),
    };
  };
  const work = makeTestWriterWork({
    store: { testSet: async () => existing, saveTestSet: async (s) => void saved.push(s) },
    budget: { spent: async () => spent, addSpend: async (_m, usd) => void spend.push(usd) },
    fetchQuestion: async () => twoSum,
    claude: async (model) => {
      calls.push(model);
      return answers[calls.length - 1];
    },
    runCode,
    capUsd: 5,
    now: () => NOW,
  });
  return { work, calls, saved, spend };
};

describe("the Test writer", () => {
  it("keeps Haiku's tests when they pass the check, dropping inputs the reference can't handle", async () => {
    const { work, calls, saved, spend } = setup({ answers: [{ kind: "ok", data: written(), usage }], badInputs: [3] });
    await work({ problemId: "1", slug: "two-sum" });
    expect(calls).toEqual(["claude-haiku-5-5"]);
    expect(saved[0]).toMatchObject({ status: "full", model: "claude-haiku-5-5", flagged: [] });
    expect(saved[0].tests).toHaveLength(15); // 16 written, test 4 dropped
    expect(saved[0].tests.map((t) => t.id)).not.toContain("t4");
    expect(saved[0].tests.at(-1)).toMatchObject({ id: "L1", large: true, seed: 1 });
    expect(spend[0]).toBeCloseTo(0.0023, 6); // 3,000 in + 4,000 out on Haiku
  });

  it("moves on to Sonnet when Haiku's reference gets an example wrong", async () => {
    const answers: ClaudeAnswer[] = [
      { kind: "ok", data: written(), usage },
      { kind: "ok", data: written(), usage },
    ];
    const { work, calls, saved } = setup({ answers, referenceOk: [false, true] });
    await work({ problemId: "1", slug: "two-sum" });
    expect(calls).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(saved[0]).toMatchObject({ status: "full", model: "claude-sonnet-5-5" });
  });

  it("marks the problem limited when both fail, including too few good tests", async () => {
    const answers: ClaudeAnswer[] = [
      { kind: "ok", data: written(5), usage }, // 6 tests: fewer than 8
      { kind: "refused", usage },
    ];
    const { work, saved } = setup({ answers });
    await work({ problemId: "1", slug: "two-sum" });
    expect(saved[0]).toMatchObject({ status: "limited", reason: "The AI's tests didn't pass the check", tests: [] });
    expect(saved[0].costUsd).toBeCloseTo(costFor("claude-haiku-5-5", usage) + costFor("claude-sonnet-5-5", usage), 6);
  });

  it("makes no AI call when the monthly budget is used up", async () => {
    const { work, calls, saved } = setup({ answers: [], spent: 5 });
    await work({ problemId: "1", slug: "two-sum" });
    expect(calls).toEqual([]);
    expect(saved[0]).toMatchObject({ status: "limited", reason: "The monthly AI budget is used up" });
  });

  it("never pays twice for a full set, unless you asked for a rewrite", async () => {
    const existing: TestSet = {
      problemId: "1", status: "full", reference: "old", tests: [], flagged: ["t2"], model: "claude-haiku-5-5",
      writtenAt: new Date(NOW - 86_400_000).toISOString(), costUsd: 0.002,
    };
    const again = setup({ answers: [], existing });
    await again.work({ problemId: "1", slug: "two-sum" });
    expect(again.calls).toEqual([]);

    const rewrite = setup({ answers: [{ kind: "ok", data: written(), usage }], existing });
    await rewrite.work({ problemId: "1", slug: "two-sum", rewrite: true });
    expect(rewrite.saved[0]).toMatchObject({ status: "full", flagged: [] }); // a rewrite clears flags
  });

  it("a failed rewrite keeps the old tests", async () => {
    const existing: TestSet = {
      problemId: "1", status: "full", reference: "old", tests: [{ id: "t1", input: "[1]\n1", large: false }], flagged: [],
      model: "claude-haiku-5-5", writtenAt: new Date(NOW - 86_400_000).toISOString(), costUsd: 0.002,
    };
    const { work, saved } = setup({ answers: [{ kind: "invalid", usage }, { kind: "invalid", usage }], existing });
    await work({ problemId: "1", slug: "two-sum", rewrite: true });
    expect(saved[0]).toMatchObject({ status: "full", reference: "old", reason: "The AI's tests didn't pass the check" });
  });

  it("asks with the renamed statement, the starter code and the examples", () => {
    const p = buildJudgeProblem(twoSum);
    if (typeof p === "string") throw new Error(p);
    const prompt = buildWriterPrompt(p);
    expect(prompt).toContain("def solve(self");
    expect(prompt).toContain("2 <= nums.length <= 10^4");
    expect(prompt).toContain("nums (integer[]), target (integer)");
    expect(prompt).not.toMatch(/twoSum|Two Sum/);
  });
});
