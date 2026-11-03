// The pure rules of a Mock OA: which problems can come up, what the page may see, and the score.
import type { CatalogEntry, Difficulty } from "../catalog/types";
import {
  GRACE_MS,
  MAX_OA_MINUTES,
  MAX_PROBLEMS,
  MIN_OA_MINUTES,
  passedProblem,
  type ListEntry,
  type ProblemView,
  type RunReport,
  type Session,
  type SessionProblem,
  type SessionSummary,
  type StartRequest,
  type TestCase,
  type TestSet,
} from "./types";

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const parseStart = (body: Record<string, unknown>): StartRequest | string => {
  const { count, minutes, source, difficulties = [], tags = [], unsolvedOnly = false } = body;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > MAX_PROBLEMS) return `count must be 1–${MAX_PROBLEMS}`;
  if (!Number.isInteger(minutes) || (minutes as number) < MIN_OA_MINUTES || (minutes as number) > MAX_OA_MINUTES) {
    return `minutes must be ${MIN_OA_MINUTES}–${MAX_OA_MINUTES}`;
  }
  if (source !== "catalog" && source !== "list") return "source must be catalog or list";
  if (!Array.isArray(difficulties) || !difficulties.every((d) => DIFFICULTIES.includes(d))) return "unknown difficulty";
  if (!Array.isArray(tags) || tags.length > 50 || !tags.every((t) => typeof t === "string" && SLUG.test(t))) return "tags must be topic slugs";
  if (typeof unsolvedOnly !== "boolean") return "unsolvedOnly must be true or false";
  return { count: count as number, minutes: minutes as number, source, difficulties, tags, unsolvedOnly };
};

export const parseList = (body: Record<string, unknown>): ListEntry[] | string => {
  const { problems } = body;
  if (!Array.isArray(problems) || problems.length > 500) return "problems must be a list of at most 500";
  const ok = problems.every(
    (p) => p && typeof p === "object" && typeof p.id === "string" && /^\d+$/.test(p.id) && typeof p.slug === "string" && SLUG.test(p.slug),
  );
  if (!ok) return "each problem needs an id and a slug";
  const seen = new Set<string>();
  return (problems as ListEntry[]).filter((p) => !seen.has(p.slug) && seen.add(p.slug)).map(({ id, slug }) => ({ id, slug }));
};

export const shuffle = <T>(items: T[], random: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// Every problem that may come up, in random order. Premium problems never do (#44).
export const candidates = (
  req: StartRequest,
  catalog: CatalogEntry[],
  list: ListEntry[],
  solved: Set<string>,
  random: () => number,
): CatalogEntry[] => {
  const free = catalog.filter((p) => !p.paid);
  if (req.source === "list") {
    const bySlug = new Map(free.map((p) => [p.slug, p]));
    return shuffle(list.flatMap((e) => bySlug.get(e.slug) ?? []), random);
  }
  return shuffle(
    free.filter(
      (p) =>
        (!req.difficulties.length || req.difficulties.includes(p.difficulty)) &&
        (!req.tags.length || p.tags.some((t) => req.tags.includes(t))) &&
        (!req.unsolvedOnly || !solved.has(p.id)),
    ),
    random,
  );
};

export const isOver = (s: Session, now: number) => !!s.finishedAt || (!!s.deadline && now > Date.parse(s.deadline) + GRACE_MS);

// A problem's tests once its set is known (#63): the examples plus the AI's unflagged tests, or examples
// only ("limited") when there's no full set yet.
export const withTests = (p: SessionProblem, set: TestSet | undefined, reason: string | null): SessionProblem => {
  const examples = p.tests.filter((t) => t.source === "example");
  if (set?.status === "full" && set.reference) {
    const ai = set.tests
      .filter((t) => !set.flagged.includes(t.id))
      .map((t): TestCase => ({ id: t.id, source: "ai", input: t.input, generator: t.generator, seed: t.seed, large: t.large }));
    return { ...p, tests: [...examples, ...ai], reference: set.reference, testStatus: "ready", limitedReason: null };
  }
  return { ...p, tests: examples, reference: null, testStatus: "limited", limitedReason: reason ?? set?.reason ?? "No AI tests yet" };
};

// Run examples checks LeetCode's examples; Submit runs everything you haven't flagged (#63 G).
export const testsFor = (p: SessionProblem, submit: boolean) =>
  p.tests.filter((t) => (submit ? !p.flagged.includes(t.id) : t.source === "example"));

// What the page sees. Until the end: no title, number, topics or difficulty, nothing that names it (#62),
// and never the reference solution.
export const toView = (s: Session, now: number) => ({
  ...s,
  now: new Date(now).toISOString(),
  problems: s.problems.map(
    (p, index): ProblemView => ({
      index,
      statement: p.statement,
      stub: p.stub,
      code: p.code,
      approach: p.approach,
      activeMs: p.activeMs,
      submissions: p.submissions,
      best: p.best,
      bestReport: p.bestReport,
      last: p.last,
      recorded: p.recorded,
      testStatus: p.testStatus,
      limitedReason: p.limitedReason,
      flagged: p.flagged,
      testCounts: {
        examples: p.tests.filter((t) => t.source === "example").length,
        ai: p.tests.filter((t) => t.source === "ai" && !p.flagged.includes(t.id)).length,
      },
      examples: p.tests.filter((t) => t.source === "example").map((t) => t.input ?? ""),
      paramNames: p.spec.paramNames,
      revealed: s.finishedAt
        ? { problemId: p.problemId, slug: p.slug, title: p.title, difficulty: p.difficulty, tags: p.tags }
        : null,
    }),
  ),
});

// Broken tests (the reference couldn't handle them) and flagged ones don't count either way.
export const reportOf = (
  raw: Pick<RunReport, "compileError" | "results">,
  submit: boolean,
  at: string,
  flagged: string[] = [],
): RunReport => {
  const counted = raw.results.filter((r) => r.status !== "invalid" && !(r.testId && flagged.includes(r.testId)));
  return { ...raw, passed: counted.filter((r) => r.status === "passed").length, total: counted.length, submit, at };
};

// The same report, counted again without the tests flagged since (#63 F).
export const rescore = (r: RunReport, flagged: string[]) => reportOf(r, r.submit, r.at, flagged);

const share = (r: { passed: number; total: number }) => r.passed / Math.max(1, r.total);

// The best Submit counts, so a worse last-minute change can't lower a score you already had.
export const better = (best: RunReport | null, r: RunReport) => (!best || share(r) > share(best) ? r : best);
export const countsOf = (r: RunReport | null) => (r ? { passed: r.passed, total: r.total } : null);

export const summarize = (s: Session, finishedAt: number): SessionSummary => {
  const start = Date.parse(s.deadline ?? s.createdAt) - s.minutes * 60_000;
  const used = Math.min(s.minutes, Math.ceil((finishedAt - start) / 60_000));
  return {
    passedProblems: s.problems.filter((p) => passedProblem(p.best)).length,
    testsPassed: s.problems.reduce((n, p) => n + (p.best?.passed ?? 0), 0),
    testsTotal: s.problems.reduce((n, p) => n + (p.best?.total ?? testsFor(p, true).length), 0),
    usedMinutes: Math.max(1, used),
  };
};

// Time's up or Finish: these problems' current code still needs a Submit (#62: auto-submit everything).
export const needsFinalSubmit = (s: Session) =>
  s.problems.map((p, i) => ({ p, i })).filter(({ p }) => p.code.trim() !== "" && p.code !== p.stub && p.code !== p.submittedCode);

// Tests started before M11b were saved without the AI-test fields: fill in what they mean (examples only).
export const normalize = (s: Session): Session => ({
  ...s,
  preparingSince: s.preparingSince ?? null,
  problems: s.problems.map((p) => ({
    ...p,
    tests: p.tests.map((t, i) => ({ ...t, id: t.id ?? `e${i + 1}`, source: t.source ?? "example" })),
    reference: p.reference ?? null,
    testStatus: p.testStatus ?? "limited",
    limitedReason: p.limitedReason ?? (p.testStatus ? null : "Started before AI tests existed"),
    flagged: p.flagged ?? [],
    bestReport: p.bestReport ?? null,
  })),
});
