// Mock OA shapes shared by the API and the web app (#14, #17, #62). Type-only imports keep the web bundle SDK-free.
import type { Difficulty } from "../catalog/types";

export const MAX_PROBLEMS = 10;
export const MIN_OA_MINUTES = 5;
export const MAX_OA_MINUTES = 300;
export const PASS_RATIO = 0.8; // a problem counts as passed at 80% of its tests (#17)
export const TIME_LIMIT_MS = 2000; // per test, until M11b compares against a reference solution
export const GRACE_MS = 30_000; // a submit sent just before 0:00 still counts
export const MAX_CODE_LENGTH = 50_000;
export const NEUTRAL_FUNCTION = "solve"; // the function's real name gives the problem away (#62)
export const NEUTRAL_CLASS = "Design";

// How the runner calls your code, from LeetCode's metaData.
export interface JudgeSpec {
  kind: "function" | "design";
  realName: string; // the function or class name LeetCode uses
  paramNames: string[];
  params: string[]; // LeetCode types, e.g. "integer[]", "ListNode"
  returnType: string;
  outputParam: number | null; // "do it in place": this argument is the answer
  design: { ctor: string[]; methods: Record<string, string[]> } | null;
  anyOrder: boolean; // the statement says "in any order"
}

export interface TestCase {
  input: string; // one JSON value per line, LeetCode's format
  expected: string;
}

export type TestStatus = "passed" | "wrong" | "error" | "timeout" | "crashed" | "skipped";

export interface TestResult {
  status: TestStatus;
  ms?: number;
  output?: string;
  error?: string;
  stdout?: string;
  input?: string; // shown for failed tests: "s = \"AAAA\", k = 0"
  expected?: string;
}

export interface RunReport {
  compileError: string | null;
  results: TestResult[];
  passed: number;
  total: number;
  submit: boolean; // Submit (counts) or Run examples (practice)
  at: string;
}

export interface SessionProblem {
  // Hidden until the test is finished (#62).
  problemId: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  // Shown during the test.
  statement: string; // HTML, with the function or class renamed
  stub: string;
  spec: JudgeSpec;
  tests: TestCase[];
  code: string;
  approach: string | null; // locked before coding; saved as a normal prediction too
  approachAt?: string | null; // that prediction's time, so Cancel can delete it
  activeMs: number; // time spent with this problem open
  submissions: number;
  submittedCode: string | null; // what the last Submit ran, so time-up only re-runs changed code
  best: { passed: number; total: number } | null; // the best Submit counts
  last: RunReport | null;
  recorded: boolean;
}

export interface SessionSummary {
  passedProblems: number;
  testsPassed: number;
  testsTotal: number;
  usedMinutes: number;
}

export type ProblemSource = "catalog" | "list";

// Stored as MOCKOA#<id> / SESSION, and in the MOCKOAS drawer of GSI1 by start time.
export interface Session {
  id: string;
  createdAt: string;
  deadline: string; // kept on the server, so a refresh or a closed tab doesn't reset the clock (#62 A)
  minutes: number;
  source: ProblemSource;
  finishedAt: string | null;
  summary: SessionSummary | null;
  count: number;
  problems: SessionProblem[];
}

export interface StartRequest {
  count: number;
  minutes: number;
  source: ProblemSource;
  difficulties: Difficulty[]; // catalog only; empty = any
  tags: string[]; // catalog only; empty = any
  unsolvedOnly: boolean;
}

// One problem in "My list" (#62).
export interface ListEntry {
  id: string;
  slug: string;
}

// What the page gets: before the end, nothing that names the problem.
export type ProblemView = Omit<SessionProblem, "problemId" | "slug" | "title" | "difficulty" | "tags" | "tests" | "submittedCode" | "spec" | "approachAt"> & {
  index: number;
  examples: string[]; // example inputs, shown as "name = value"
  paramNames: string[];
  revealed: { problemId: string; slug: string; title: string; difficulty: Difficulty; tags: string[] } | null;
};

export interface SessionView extends Omit<Session, "problems"> {
  now: string; // the server's time, so the page's clock can correct for a wrong device clock
  problems: ProblemView[];
}

export type PastSession = Pick<Session, "id" | "createdAt" | "deadline" | "minutes" | "source" | "finishedAt" | "summary" | "count">;

export const passedProblem = (best: SessionProblem["best"]) => !!best && best.total > 0 && best.passed / best.total >= PASS_RATIO;
