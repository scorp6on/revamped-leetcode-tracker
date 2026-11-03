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
  type SessionSummary,
  type StartRequest,
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

export const isOver = (s: Session, now: number) => !!s.finishedAt || now > Date.parse(s.deadline) + GRACE_MS;

// What the page sees. Until the end: no title, number, topics or difficulty, nothing that names it (#62).
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
      last: p.last,
      recorded: p.recorded,
      examples: p.tests.map((t) => t.input),
      paramNames: p.spec.paramNames,
      revealed: s.finishedAt
        ? { problemId: p.problemId, slug: p.slug, title: p.title, difficulty: p.difficulty, tags: p.tags }
        : null,
    }),
  ),
});

export const reportOf = (raw: Pick<RunReport, "compileError" | "results">, submit: boolean, at: string): RunReport => ({
  ...raw,
  passed: raw.results.filter((r) => r.status === "passed").length,
  total: raw.results.length,
  submit,
  at,
});

// The best Submit counts, so a worse last-minute change can't lower a score you already had.
export const better = (best: Session["problems"][number]["best"], r: RunReport) =>
  !best || r.passed / Math.max(1, r.total) > best.passed / Math.max(1, best.total) ? { passed: r.passed, total: r.total } : best;

export const summarize = (s: Session, finishedAt: number): SessionSummary => {
  const used = Math.min(s.minutes, Math.ceil((finishedAt - Date.parse(s.createdAt)) / 60_000));
  return {
    passedProblems: s.problems.filter((p) => passedProblem(p.best)).length,
    testsPassed: s.problems.reduce((n, p) => n + (p.best?.passed ?? 0), 0),
    testsTotal: s.problems.reduce((n, p) => n + (p.best?.total ?? p.tests.length), 0),
    usedMinutes: Math.max(1, used),
  };
};

// Time's up or Finish: these problems' current code still needs a Submit (#62: auto-submit everything).
export const needsFinalSubmit = (s: Session) =>
  s.problems.map((p, i) => ({ p, i })).filter(({ p }) => p.code.trim() !== "" && p.code !== p.stub && p.code !== p.submittedCode);
