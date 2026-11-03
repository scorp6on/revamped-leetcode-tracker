import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { json, readBody } from "../http";
import type { PredictionStore } from "../problems/prediction";
import { MAX_PREDICTION_LENGTH } from "../problems/types";
import { buildJudgeProblem, showInput, type JudgeProblem, type RawQuestion } from "./leetcode";
import { better, candidates, isOver, needsFinalSubmit, parseList, parseStart, reportOf, summarize, toView } from "./session";
import type { Change, MockOaStore } from "./store";
import {
  GRACE_MS,
  MAX_CODE_LENGTH,
  NEUTRAL_CLASS,
  NEUTRAL_FUNCTION,
  TIME_LIMIT_MS,
  type RunReport,
  type Session,
  type SessionProblem,
  type TestResult,
} from "./types";

// What the Code runner Lambda answers (runner/handler.py).
export type RunnerOutput = Pick<RunReport, "compileError" | "results">;
export type RunCode = (job: Record<string, unknown>) => Promise<RunnerOutput>;

export interface MockOaDeps {
  store: MockOaStore;
  fetchQuestion: (slug: string) => Promise<RawQuestion | null>;
  runCode: RunCode;
  predictions: Pick<PredictionStore, "save">;
  now: () => number;
  random: () => number;
  newId: () => string;
}

const EXTRA_TRIES = 15; // problems that turn out unusable (custom checkers, no Python) are skipped

type Event = APIGatewayProxyEventV2;
type Result = Promise<APIGatewayProxyResultV2>;

export const makeMockOaRoutes = ({ store, fetchQuestion, runCode, predictions, now, random, newId }: MockOaDeps) => {
  // Runs code against a problem's tests; failed tests carry their input and expected answer.
  const judge = async (p: SessionProblem, code: string, submit: boolean): Promise<RunReport> => {
    const raw = await runCode({
      code,
      kind: p.spec.kind,
      entry: p.spec.kind === "design" ? NEUTRAL_CLASS : NEUTRAL_FUNCTION,
      params: p.spec.params,
      returnType: p.spec.returnType,
      outputParam: p.spec.outputParam,
      design: p.spec.design,
      tests: p.tests,
      anyOrder: p.spec.anyOrder,
      timeLimitMs: TIME_LIMIT_MS,
    });
    const results: TestResult[] = raw.results.map((r, i) =>
      r.status === "passed" || r.status === "skipped"
        ? r
        : { ...r, input: showInput(p.spec, p.tests[i].input), expected: p.tests[i].expected },
    );
    return reportOf({ compileError: raw.compileError, results }, submit, new Date(now()).toISOString());
  };

  const submitChanges = (i: number, p: SessionProblem, code: string, report: RunReport): Change[] => [
    [["problems", i, "code"], code],
    [["problems", i, "last"], report],
    [["problems", i, "submissions"], p.submissions + 1],
    [["problems", i, "submittedCode"], code],
    [["problems", i, "best"], better(p.best, report)],
  ];

  // Time's up or Finish: submit every problem whose code changed since its last Submit, then score (#62).
  const finish = async (s: Session): Promise<Session> => {
    if (s.finishedAt) return s;
    const pending = needsFinalSubmit(s);
    const reports = await Promise.all(pending.map(({ p }) => judge(p, p.code, true)));
    const changes: Change[] = pending.flatMap(({ p, i }, k) => submitChanges(i, p, p.code, reports[k]));
    const finished: Session = structuredClone(s);
    pending.forEach(({ p, i }, k) => {
      finished.problems[i] = { ...p, last: reports[k], submissions: p.submissions + 1, submittedCode: p.code, best: better(p.best, reports[k]) };
    });
    const at = Math.min(now(), Date.parse(s.deadline));
    finished.finishedAt = new Date(at).toISOString();
    finished.summary = summarize(finished, at);
    changes.push([["finishedAt"], finished.finishedAt], [["summary"], finished.summary]);
    // Two tabs finishing at once: the first one wins and the other reads its result.
    if (await store.update(s.id, changes, true)) return finished;
    return (await store.get(s.id)) ?? finished;
  };

  const load = async (event: Event) => {
    const id = event.pathParameters?.id ?? "";
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    return (await store.get(id)) ?? null;
  };

  const problemOf = (event: Event, s: Session) => {
    const i = Number(event.pathParameters?.index);
    return Number.isInteger(i) && i >= 0 && i < s.problems.length ? i : null;
  };

  return {
    // The setup page: past tests and your list.
    async home(): Result {
      const [past, list] = await Promise.all([store.past(), store.list()]);
      return json(200, { past, list });
    },

    async saveList(event: Event): Result {
      const list = parseList(readBody(event));
      if (typeof list === "string") return json(400, { error: list });
      await store.saveList(list);
      return json(200, { list });
    },

    async start(event: Event): Result {
      const req = parseStart(readBody(event));
      if (typeof req === "string") return json(400, { error: req });
      const [catalog, list, solved] = await Promise.all([store.catalog(), req.source === "list" ? store.list() : [], req.unsolvedOnly ? store.solved() : new Set<string>()]);
      const pool = candidates(req, catalog, list, solved, random);
      if (pool.length < req.count) {
        return json(422, { error: `Only ${pool.length} problem${pool.length === 1 ? "" : "s"} match, and you asked for ${req.count}.` });
      }

      // Fetch a batch, keep what works, top up from the rest of the shuffled pool.
      const picked: JudgeProblem[] = [];
      const skipped: { slug: string; reason: string }[] = [];
      let next = 0;
      const limit = Math.min(pool.length, req.count + EXTRA_TRIES);
      while (picked.length < req.count && next < limit) {
        const batch = pool.slice(next, next + Math.min(req.count - picked.length, limit - next));
        next += batch.length;
        const built = await Promise.all(
          batch.map(async (c) => {
            try {
              const q = await fetchQuestion(c.slug);
              return q ? buildJudgeProblem(q) : "not found on LeetCode";
            } catch (err) {
              console.error("LeetCode fetch failed", c.slug, err);
              return "LeetCode didn't answer";
            }
          }),
        );
        built.forEach((b, k) => (typeof b === "string" ? skipped.push({ slug: batch[k].slug, reason: b }) : picked.push(b)));
      }
      if (picked.length < req.count) {
        return json(422, { error: `Only ${picked.length} of the matching problems can be judged here.`, skipped });
      }

      const t = now();
      const session: Session = {
        id: newId(),
        createdAt: new Date(t).toISOString(),
        deadline: new Date(t + req.minutes * 60_000).toISOString(),
        minutes: req.minutes,
        source: req.source,
        finishedAt: null,
        summary: null,
        count: picked.length,
        problems: picked.map((p) => ({
          ...p,
          code: p.stub,
          approach: null,
          approachAt: null,
          activeMs: 0,
          submissions: 0,
          submittedCode: null,
          best: null,
          last: null,
          recorded: false,
        })),
      };
      await store.create(session);
      return json(201, { id: session.id, skipped });
    },

    async get(event: Event): Result {
      let s = await load(event);
      if (!s) return json(404, { error: "No such mock OA" });
      // The tab was closed when time ran out: finish it now (#62).
      if (!s.finishedAt && isOver(s, now())) s = await finish(s);
      return json(200, { session: toView(s, now()) });
    },

    // Autosave (#62 A): your code and how long you've had this problem open.
    async save(event: Event): Result {
      const s = await load(event);
      if (!s) return json(404, { error: "No such mock OA" });
      const i = problemOf(event, s);
      if (i === null) return json(404, { error: "No such problem" });
      const { code, activeMs } = readBody(event);
      if (typeof code !== "string" || code.length > MAX_CODE_LENGTH) return json(400, { error: "code is required" });
      if (!Number.isInteger(activeMs) || (activeMs as number) < 0) return json(400, { error: "activeMs must be a whole number" });
      if (isOver(s, now())) return json(409, { error: "Time's up" });
      const ok = await store.update(
        s.id,
        [
          [["problems", i, "code"], code],
          [["problems", i, "activeMs"], Math.max(s.problems[i].activeMs, activeMs as number)],
        ],
        true,
      );
      return ok ? json(200, { saved: true }) : json(409, { error: "Time's up" });
    },

    // Your approach, locked before coding (#14). It's also saved as a normal prediction, so recording
    // the attempt later claims it and the AI review grades it as usual.
    async approach(event: Event): Result {
      const s = await load(event);
      if (!s) return json(404, { error: "No such mock OA" });
      const i = problemOf(event, s);
      if (i === null) return json(404, { error: "No such problem" });
      const { text: raw } = readBody(event);
      const text = typeof raw === "string" ? raw.trim() : "";
      if (!text || text.length > MAX_PREDICTION_LENGTH) return json(400, { error: `approach must be 1–${MAX_PREDICTION_LENGTH} characters` });
      if (isOver(s, now())) return json(409, { error: "Time's up" });
      const p = s.problems[i];
      if (p.approach) return json(409, { error: "Already locked" });
      const createdAt = new Date(now()).toISOString();
      await store.update(s.id, [[["problems", i, "approach"], text], [["problems", i, "approachAt"], createdAt]], true);
      await predictions.save({ problemId: p.problemId, slug: p.slug, text, createdAt, claimed: false });
      return json(200, { approach: text });
    },

    // Run examples (practice) or Submit (counts toward the score).
    async run(event: Event): Result {
      const s = await load(event);
      if (!s) return json(404, { error: "No such mock OA" });
      const i = problemOf(event, s);
      if (i === null) return json(404, { error: "No such problem" });
      const { code, submit } = readBody(event);
      if (typeof code !== "string" || !code.trim() || code.length > MAX_CODE_LENGTH) return json(400, { error: "code is required" });
      if (isOver(s, now())) return json(409, { error: "Time's up" });
      const p = s.problems[i];
      if (!p.approach) return json(400, { error: "Lock your approach first" });
      const report = await judge(p, code, submit === true);
      const changes: Change[] = submit === true ? submitChanges(i, p, code, report) : [[["problems", i, "code"], code], [["problems", i, "last"], report]];
      if (!(await store.update(s.id, changes, true))) return json(409, { error: "Time's up" });
      return json(200, { report, best: submit === true ? better(p.best, report) : p.best });
    },

    // Started by accident: the test is deleted and never counts, and so are the approaches locked in
    // it, so a later normal attempt doesn't claim one as its prediction. Running tests only.
    async cancel(event: Event): Result {
      const s = await load(event);
      if (!s) return json(404, { error: "No such mock OA" });
      if (s.finishedAt) return json(409, { error: "A finished test can't be canceled" });
      if (!(await store.remove(s.id))) return json(409, { error: "A finished test can't be canceled" });
      await Promise.all(
        s.problems.flatMap((p) => (p.approachAt ? [store.removePrediction(p.problemId, p.approachAt)] : [])),
      );
      return json(200, { canceled: true });
    },

    // Finish early, or the page's clock hit 0:00. Saves the page's latest code first.
    async finish(event: Event): Result {
      let s = await load(event);
      if (!s) return json(404, { error: "No such mock OA" });
      const { codes } = readBody(event);
      if (!s.finishedAt && Array.isArray(codes) && codes.length === s.problems.length && codes.every((c) => typeof c === "string" && c.length <= MAX_CODE_LENGTH)) {
        const changed = (codes as string[]).map((c, i) => ({ c, i })).filter(({ c, i }) => c !== s!.problems[i].code);
        if (changed.length && now() <= Date.parse(s.deadline) + GRACE_MS) {
          await store.update(s.id, changed.map(({ c, i }): Change => [["problems", i, "code"], c]), true);
          s = (await store.get(s.id))!;
        }
      }
      s = await finish(s);
      return json(200, { session: toView(s, now()) });
    },
  };
};
