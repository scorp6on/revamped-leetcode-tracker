import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "../catalog/types";
import { buildJudgeProblem, exampleOutputs, showInput, type RawQuestion } from "./leetcode";
import { makeMockOaRoutes, type RunCode } from "./routes";
import { candidates, parseStart, toView } from "./session";
import { updateExpression, type Change, type MockOaStore } from "./store";
import type { Session } from "./types";

const twoSum = (over: Partial<RawQuestion> = {}): RawQuestion => ({
  id: "1",
  title: "Two Sum",
  slug: "two-sum",
  difficulty: "Easy",
  paid: false,
  category: "Algorithms",
  content:
    "<p>Return indices. Call <code>twoSum(nums, target)</code>, in <strong>any order</strong>.</p>" +
    "<p><strong>Output:</strong> <code>[0,1]</code></p><p><strong>Output:</strong> <code>[1,2]</code></p>",
  examples: ["[2,7,11,15]\n9", "[3,2,4]\n6"],
  metaData: JSON.stringify({ name: "twoSum", params: [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }], return: { type: "integer[]" } }),
  tags: [{ slug: "array" }],
  snippets: [{ lang: "python3", code: "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        " }],
  ...over,
});

const lru = (): RawQuestion => ({
  ...twoSum(),
  id: "146",
  title: "LRU Cache",
  slug: "lru-cache",
  content: "<p>Implement the <code>LRUCache</code> class.</p><pre>\n<strong>Output</strong>\n[null, null, 1]\n\n<strong>Explanation</strong>\nLRUCache lRUCache = new LRUCache(2);</pre>",
  examples: ['["LRUCache","put","get"]\n[[2],[1,1],[1]]'],
  metaData: JSON.stringify({
    classname: "LRUCache",
    constructor: { params: [{ type: "integer", name: "capacity" }] },
    methods: [{ name: "get", params: [{ type: "integer", name: "key" }] }, { name: "put", params: [{ type: "integer" }, { type: "integer" }] }],
  }),
  snippets: [{ lang: "python3", code: "class LRUCache:\n\n    def __init__(self, capacity: int):\n        \n\n# obj = LRUCache(capacity)" }],
});

describe("reading LeetCode problems", () => {
  it("reads example outputs in each of LeetCode's formats", () => {
    expect(exampleOutputs('<p><strong>Output:</strong> <span class="example-io">[[&quot;bat&quot;]]</span></p>')).toEqual(['[["bat"]]']);
    expect(exampleOutputs("<pre><strong>Output:</strong> 2.00000\n<strong>Explanation:</strong> x</pre>")).toEqual(["2.00000"]);
    expect(exampleOutputs(lru().content!)).toEqual(["[null, null, 1]"]);
    // A custom checker's output isn't a plain value: that problem can't be judged here.
    expect(exampleOutputs("<pre><strong>Output:</strong> 2, nums = [1,2,_]</pre>")).toBeNull();
  });

  it("renames the function in the code and in code text, and keeps the real name for later", () => {
    const p = buildJudgeProblem(twoSum());
    if (typeof p === "string") throw new Error(p);
    expect(p.stub).toContain("def solve(self, nums");
    expect(p.statement).toContain("<code>solve(nums, target)</code>");
    expect(p.statement).not.toMatch(/twoSum/);
    expect(p.spec).toMatchObject({ kind: "function", realName: "twoSum", params: ["integer[]", "integer"], anyOrder: true });
    expect(p.tests).toEqual([{ input: "[2,7,11,15]\n9", expected: "[0,1]" }, { input: "[3,2,4]\n6", expected: "[1,2]" }]);
    expect(showInput(p.spec, p.tests[0].input)).toBe("nums = [2,7,11,15], target = 9");
  });

  it("only renames a function name where it's code, since it can be an English word", () => {
    const q = twoSum({
      content: "<p>Use binary search. Implement <code>search</code>.</p><p><strong>Output:</strong> <code>1</code></p><p><strong>Output:</strong> <code>2</code></p>",
      metaData: JSON.stringify({ name: "search", params: [{ name: "nums", type: "integer[]" }], return: { type: "integer" } }),
      snippets: [{ lang: "python3", code: "class Solution:\n    def search(self, nums: List[int]) -> int:\n" }],
    });
    const p = buildJudgeProblem(q);
    if (typeof p === "string") throw new Error(p);
    expect(p.statement).toContain("binary search");
    expect(p.statement).toContain("<code>solve</code>");
  });

  it("renames a design problem's class everywhere, keeping its methods", () => {
    const p = buildJudgeProblem(lru());
    if (typeof p === "string") throw new Error(p);
    expect(p.stub).toContain("class Design:");
    expect(p.stub).toContain("# obj = Design(capacity)");
    expect(p.statement).toContain("Design design = new Design(2)");
    expect(p.statement).not.toMatch(/lru/i);
    expect(p.spec.design).toEqual({ ctor: ["integer"], methods: { get: ["integer"], put: ["integer", "integer"] } });
  });

  it("refuses problems it can't judge", () => {
    expect(buildJudgeProblem(twoSum({ paid: true }))).toBe("Premium");
    expect(buildJudgeProblem(twoSum({ category: "Database" }))).toMatch(/Database/);
    expect(buildJudgeProblem(twoSum({ snippets: [{ lang: "java", code: "" }] }))).toBe("no Python 3 version");
    expect(buildJudgeProblem(twoSum({ metaData: JSON.stringify({ name: "guess", params: [], manual: true }) }))).toMatch(/interactive/);
    expect(buildJudgeProblem(twoSum({ examples: ["[1]\n1"] }))).toMatch(/example outputs/);
  });
});

const entry = (id: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id, title: `P${id}`, slug: `p-${id}`, difficulty: "Medium", ac: 50, paid: false, tags: ["array"], ...over,
});

describe("picking problems", () => {
  const catalog = [entry("1"), entry("2", { difficulty: "Hard" }), entry("3", { paid: true }), entry("4", { tags: ["graph"] })];
  const req = (over = {}) => ({ count: 1, minutes: 30, source: "catalog" as const, difficulties: [], tags: [], unsolvedOnly: false, ...over });
  const ids = (es: CatalogEntry[]) => es.map((e) => e.id).sort();

  it("filters the catalog and never picks Premium problems", () => {
    expect(ids(candidates(req(), catalog, [], new Set(), Math.random))).toEqual(["1", "2", "4"]);
    expect(ids(candidates(req({ difficulties: ["Hard"] }), catalog, [], new Set(), Math.random))).toEqual(["2"]);
    expect(ids(candidates(req({ tags: ["graph"] }), catalog, [], new Set(), Math.random))).toEqual(["4"]);
    expect(ids(candidates(req({ unsolvedOnly: true }), catalog, [], new Set(["1"]), Math.random))).toEqual(["2", "4"]);
  });

  it("picks only from your list when that's the source", () => {
    const list = [{ id: "2", slug: "p-2" }, { id: "3", slug: "p-3" }];
    expect(ids(candidates(req({ source: "list", difficulties: ["Easy"] }), catalog, list, new Set(), Math.random))).toEqual(["2"]);
  });

  it("checks the start request", () => {
    expect(parseStart({ count: 11, minutes: 30, source: "catalog" })).toMatch(/count/);
    expect(parseStart({ count: 3, minutes: 4, source: "catalog" })).toMatch(/minutes/);
    expect(parseStart({ count: 3, minutes: 90, source: "list" })).toMatchObject({ count: 3, minutes: 90, difficulties: [] });
  });
});

describe("update expressions", () => {
  it("addresses fields inside the problem list", () => {
    const e = updateExpression([[["problems", 2, "code"], "x"], [["finishedAt"], "t"]]);
    expect(e.UpdateExpression).toBe("SET #problems[2].#code = :v0, #finishedAt = :v1");
    expect(e.ExpressionAttributeNames).toEqual({ "#problems": "problems", "#code": "code", "#finishedAt": "finishedAt" });
  });
});

// An in-memory store that applies changes like DynamoDB would.
const memoryStore = (sessions: Session[] = []) => {
  const removed: string[] = [];
  const byId = new Map(sessions.map((s) => [s.id, structuredClone(s)]));
  const store: MockOaStore = {
    get: async (id) => structuredClone(byId.get(id)),
    create: async (s) => void byId.set(s.id, structuredClone(s)),
    update: async (id, changes: Change[], onlyIfRunning) => {
      const s = byId.get(id) as unknown as Record<string, unknown>;
      if (!s || (onlyIfRunning && s.finishedAt)) return false;
      for (const [path, value] of changes) {
        let target = s as Record<string | number, unknown>;
        for (const part of path.slice(0, -1)) target = target[part] as Record<string | number, unknown>;
        target[path[path.length - 1]] = structuredClone(value);
      }
      return true;
    },
    past: async () => [],
    list: async () => [],
    saveList: async () => {},
    catalog: async () => [entry("1", { slug: "two-sum" })],
    solved: async () => new Set(),
    remove: async (id) => {
      if (byId.get(id)?.finishedAt) return false;
      return byId.delete(id);
    },
    removePrediction: async (problemId, createdAt) => void removed.push(`${problemId}@${createdAt}`),
  };
  return { store, byId, removed };
};

const T0 = Date.parse("2026-11-03T12:00:00.000Z");
const ID = "00000000-0000-4000-8000-000000000001";
const event = (path: Record<string, string>, body?: unknown) =>
  ({ pathParameters: path, body: body === undefined ? undefined : JSON.stringify(body) }) as unknown as APIGatewayProxyEventV2;
const bodyOf = (r: unknown) => JSON.parse((r as APIGatewayProxyStructuredResultV2).body as string);
const status = (r: unknown) => (r as APIGatewayProxyStructuredResultV2).statusCode;

describe("a mock OA from start to finish", () => {
  const setup = () => {
    let clock = T0;
    const runs: Record<string, unknown>[] = [];
    // The fake runner passes a test when the code mentions "good".
    const runCode: RunCode = async (job) => {
      runs.push(job);
      const pass = String(job.code).includes("good");
      return { compileError: null, results: (job.tests as unknown[]).map(() => ({ status: pass ? "passed" : "wrong", output: "[9]" })) };
    };
    const saved: unknown[] = [];
    const mem = memoryStore();
    const routes = makeMockOaRoutes({
      store: mem.store,
      fetchQuestion: async () => twoSum(),
      runCode,
      predictions: { save: async (p) => void saved.push(p) },
      now: () => clock,
      random: () => 0.5,
      newId: () => ID,
    });
    return { routes, runs, saved, mem, tick: (ms: number) => (clock += ms) };
  };

  it("hides what names the problem until the end, then shows it", async () => {
    const { routes } = setup();
    expect(status(await routes.start(event({}, { count: 1, minutes: 30, source: "catalog" })))).toBe(201);
    const { session } = bodyOf(await routes.get(event({ id: ID })));
    const p = session.problems[0];
    expect(p.revealed).toBeNull();
    expect(JSON.stringify(session)).not.toMatch(/twoSum|Two Sum|two-sum/);
    expect(p.stub).toContain("def solve(");

    const done = bodyOf(await routes.finish(event({ id: ID }, {}))).session;
    expect(done.problems[0].revealed).toMatchObject({ title: "Two Sum", slug: "two-sum", difficulty: "Easy" });
  });

  it("needs your approach locked before running, and saves it as a prediction", async () => {
    const { routes, saved } = setup();
    await routes.start(event({}, { count: 1, minutes: 30, source: "catalog" }));
    const ref = { id: ID, index: "0" };
    expect(status(await routes.run(event(ref, { code: "x", submit: false })))).toBe(400);
    expect(status(await routes.approach(event(ref, { text: "hash map of complements" })))).toBe(200);
    expect(saved).toMatchObject([{ problemId: "1", slug: "two-sum", text: "hash map of complements" }]);
    expect(status(await routes.approach(event(ref, { text: "again" })))).toBe(409);
    const r = bodyOf(await routes.run(event(ref, { code: "good", submit: true })));
    expect(r.report).toMatchObject({ passed: 2, total: 2, submit: true });
    expect(r.best).toEqual({ passed: 2, total: 2 });
  });

  it("keeps your best Submit, and a failed test shows its input", async () => {
    const { routes } = setup();
    await routes.start(event({}, { count: 1, minutes: 30, source: "catalog" }));
    const ref = { id: ID, index: "0" };
    await routes.approach(event(ref, { text: "x" }));
    await routes.run(event(ref, { code: "good", submit: true }));
    const worse = bodyOf(await routes.run(event(ref, { code: "bad", submit: true })));
    expect(worse.best).toEqual({ passed: 2, total: 2 });
    expect(worse.report.results[0]).toMatchObject({ status: "wrong", input: "nums = [2,7,11,15], target = 9", expected: "[0,1]" });
  });

  it("when time runs out, submits changed code and scores the test, even with the tab closed", async () => {
    const { routes, runs, tick } = setup();
    await routes.start(event({}, { count: 1, minutes: 30, source: "catalog" }));
    await routes.save(event({ id: ID, index: "0" }, { code: "good but never submitted", activeMs: 60_000 }));
    tick(31 * 60_000);
    expect(status(await routes.save(event({ id: ID, index: "0" }, { code: "late", activeMs: 1 })))).toBe(409);
    const { session } = bodyOf(await routes.get(event({ id: ID })));
    expect(runs).toHaveLength(1);
    expect(session.finishedAt).toBe(new Date(T0 + 30 * 60_000).toISOString());
    expect(session.summary).toEqual({ passedProblems: 1, testsPassed: 2, testsTotal: 2, usedMinutes: 30 });
    expect(session.problems[0].code).toBe("good but never submitted");
  });

  it("finishing twice doesn't run anything again", async () => {
    const { routes, runs } = setup();
    await routes.start(event({}, { count: 1, minutes: 30, source: "catalog" }));
    await routes.finish(event({ id: ID }, { codes: ["good"] }));
    await routes.finish(event({ id: ID }, { codes: ["other"] }));
    expect(runs).toHaveLength(1);
  });

  it("cancels a running test: it's deleted, with the predictions it locked", async () => {
    const { routes, mem, tick } = setup();
    await routes.start(event({}, { count: 1, minutes: 30, source: "catalog" }));
    tick(60_000);
    await routes.approach(event({ id: ID, index: "0" }, { text: "hash map" }));
    expect(status(await routes.cancel(event({ id: ID })))).toBe(200);
    expect(mem.byId.has(ID)).toBe(false);
    expect(mem.removed).toEqual([`1@${new Date(T0 + 60_000).toISOString()}`]);
    expect(status(await routes.get(event({ id: ID })))).toBe(404);
  });

  it("won't cancel a finished test", async () => {
    const { routes, mem } = setup();
    await routes.start(event({}, { count: 1, minutes: 30, source: "catalog" }));
    await routes.finish(event({ id: ID }, {}));
    expect(status(await routes.cancel(event({ id: ID })))).toBe(409);
    expect(mem.byId.has(ID)).toBe(true);
  });

  it("says why when not enough problems match", async () => {
    const { routes } = setup();
    const r = await routes.start(event({}, { count: 3, minutes: 30, source: "catalog" }));
    expect(status(r)).toBe(422);
    expect(bodyOf(r).error).toMatch(/Only 1 problem match/);
  });
});

describe("the page's view", () => {
  it("shows example inputs but not tests' expected answers", () => {
    const p = buildJudgeProblem(twoSum());
    if (typeof p === "string") throw new Error(p);
    const s: Session = {
      id: ID, createdAt: "", deadline: "", minutes: 30, source: "catalog", finishedAt: null, summary: null, count: 1,
      problems: [{ ...p, code: "", approach: null, activeMs: 0, submissions: 0, submittedCode: null, best: null, last: null, recorded: false }],
    };
    const v = toView(s, T0).problems[0];
    expect(v.examples).toEqual(["[2,7,11,15]\n9", "[3,2,4]\n6"]);
    expect(v).not.toHaveProperty("tests");
    expect(v).not.toHaveProperty("spec");
  });
});
