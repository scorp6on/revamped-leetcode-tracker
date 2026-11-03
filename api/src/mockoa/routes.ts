import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { json, readBody } from "../http";
import type { PredictionStore } from "../problems/prediction";
import { MAX_PREDICTION_LENGTH } from "../problems/types";
import { SLUG } from "../problems/leetcode";
import { buildJudgeProblem, showInput, type JudgeProblem, type RawQuestion } from "./leetcode";
import {
  better,
  candidates,
  countsOf,
  isOver,
  needsFinalSubmit,
  normalize,
  parseList,
  parseStart,
  reportOf,
  rescore,
  summarize,
  testsFor,
  toView,
  withTests,
} from "./session";
import type { Change, MockOaStore } from "./store";
import {
  GRACE_MS,
  MAX_CODE_LENGTH,
  NEUTRAL_CLASS,
  NEUTRAL_FUNCTION,
  PREPARE_MS,
  TIME_LIMIT_MS,
  type RunReport,
  type Session,
  type SessionProblem,
  type TestResult,
} from "./types";
import type { WriterMessage } from "./writer";

// What the Code runner Lambda answers (runner/handler.py).
export type RunnerOutput = Pick<RunReport, "compileError" | "results">;
export type RunCode = (job: Record<string, unknown>) => Promise<RunnerOutput>;

export interface MockOaDeps {
  store: MockOaStore;
  fetchQuestion: (slug: string) => Promise<RawQuestion | null>;
  runCode: RunCode;
  predictions: Pick<PredictionStore, "save">;
  enqueueTests: (m: WriterMessage) => Promise<void>; // the Test writer queue (#63)
  budgetLeft: () => Promise<boolean>; // under this month's AI cap
  now: () => number;
  random: () => number;
  newId: () => string;
}

const EXTRA_TRIES = 15; // problems that turn out unusable (custom checkers, no Python) are skipped

type Event = APIGatewayProxyEventV2;
type Result = Promise<APIGatewayProxyResultV2>;

export const makeMockOaRoutes = ({ store, fetchQuestion, runCode, predictions, enqueueTests, budgetLeft, now, random, newId }: MockOaDeps) => {
  const iso = () => new Date(now()).toISOString();

  // Runs code against a problem's tests, with the reference next to it when there is one (#63).
  // Failed tests carry what you need to see why: input (or a preview of a big one) and the expected answer.
  const judge = async (p: SessionProblem, code: string, submit: boolean): Promise<RunReport> => {
    const tests = testsFor(p, submit);
    const raw = await runCode({
      code,
      reference: p.reference,
      kind: p.spec.kind,
      entry: p.spec.kind === "design" ? NEUTRAL_CLASS : NEUTRAL_FUNCTION,
      params: p.spec.params,
      returnType: p.spec.returnType,
      outputParam: p.spec.outputParam,
      design: p.spec.design,
      tests: tests.map(({ input, generator, seed, expected }) => ({ input, generator, seed, expected })),
      anyOrder: p.spec.anyOrder,
      timeLimitMs: TIME_LIMIT_MS,
    });
    const results: TestResult[] = raw.results.map((r, i) => {
      const t = tests[i];
      const base: TestResult = { ...r, testId: t.id, source: t.source, large: !!t.large };
      if (r.status === "passed" || r.status === "skipped") return base;
      return { ...base, input: t.input !== undefined ? showInput(p.spec, t.input) : r.preview, expected: t.expected ?? r.expected };
    });
    return reportOf({ compileError: raw.compileError, results }, submit, iso(), p.flagged);
  };

  const submitted = (p: SessionProblem, code: string, report: RunReport): SessionProblem => {
    const bestReport = better(p.bestReport, report);
    return { ...p, code, last: report, submissions: p.submissions + 1, submittedCode: code, bestReport, best: countsOf(bestReport) };
  };
  const problemChanges = (i: number, p: SessionProblem, fields: (keyof SessionProblem)[]): Change[] =>
    fields.map((f) => [["problems", i, f], p[f]]);
  const SUBMIT_FIELDS: (keyof SessionProblem)[] = ["code", "last", "submissions", "submittedCode", "best", "bestReport"];

  // Time's up or Finish: submit every problem whose code changed since its last Submit, then score (#62).
  const finish = async (s: Session): Promise<Session> => {
    if (s.finishedAt) return s;
    const pending = needsFinalSubmit(s);
    const reports = await Promise.all(pending.map(({ p }) => judge(p, p.code, true)));
    const finished: Session = structuredClone(s);
    const changes: Change[] = [];
    pending.forEach(({ p, i }, k) => {
      finished.problems[i] = submitted(p, p.code, reports[k]);
      changes.push(...problemChanges(i, finished.problems[i], SUBMIT_FIELDS));
    });
    const at = Math.min(now(), s.deadline ? Date.parse(s.deadline) : now());
    finished.finishedAt = new Date(at).toISOString();
    finished.summary = summarize(finished, at);
    changes.push([["finishedAt"], finished.finishedAt], [["summary"], finished.summary]);
    // Two tabs finishing at once: the first one wins and the other reads its result.
    if (await store.update(s.id, changes, true)) return finished;
    const won = await store.get(s.id);
    return won ? normalize(won) : finished;
  };

  // While tests are being written (#63): attach the ones that are ready. The clock starts when all are,
  // or after 90 s anyway, with the rest on examples only ("limited tests").
  const prepare = async (s: Session): Promise<Session> => {
    if (!s.preparingSince || s.finishedAt) return s;
    const since = Date.parse(s.preparingSince);
    const out: Session = structuredClone(s);
    const waiting = out.problems.map((p, i) => ({ p, i })).filter(({ p }) => p.testStatus === "writing");
    const sets = await Promise.all(waiting.map(({ p }) => store.testSet(p.problemId)));
    const timedOut = now() - since >= PREPARE_MS;
    let still = 0;
    waiting.forEach(({ p, i }, k) => {
      const set = sets[k];
      if (set && Date.parse(set.writtenAt) >= since) out.problems[i] = withTests(p, set, null);
      else if (timedOut) out.problems[i] = withTests(p, set, "The AI was still writing its tests when the clock started");
      else still++;
    });
    if (still) return out; // the page asks again in a moment
    out.preparingSince = null;
    out.deadline = new Date(now() + s.minutes * 60_000).toISOString();
    const changes: Change[] = [
      ...waiting.flatMap(({ i }) => problemChanges(i, out.problems[i], ["tests", "reference", "testStatus", "limitedReason"])),
      [["preparingSince"], null],
      [["deadline"], out.deadline],
    ];
    await store.update(s.id, changes, true);
    return out;
  };

  const load = async (event: Event) => {
    const id = event.pathParameters?.id ?? "";
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const s = await store.get(id);
    return s ? normalize(s) : null;
  };

  const problemOf = (event: Event, s: Session) => {
    const i = Number(event.pathParameters?.index);
    return Number.isInteger(i) && i >= 0 && i < s.problems.length ? i : null;
  };

  // Refuses changes before the clock starts and after it ends.
  const closed = (s: Session) =>
    s.preparingSince ? json(409, { error: "The test hasn't started yet" }) : isOver(s, now()) ? json(409, { error: "Time's up" }) : null;

  const problemIdOf = (event: Event) => {
    const id = event.pathParameters?.problemId ?? "";
    return /^\d+$/.test(id) ? id : null;
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

      // Problems with a full test set are ready; the rest are written now, if the budget allows (#63).
      const [sets, canWrite] = await Promise.all([Promise.all(picked.map((p) => store.testSet(p.problemId))), budgetLeft()]);
      const problems = await Promise.all(
        picked.map(async (p, k): Promise<SessionProblem> => {
          const base: SessionProblem = {
            ...p,
            code: p.stub,
            approach: null,
            approachAt: null,
            activeMs: 0,
            submissions: 0,
            submittedCode: null,
            best: null,
            bestReport: null,
            last: null,
            recorded: false,
            reference: null,
            testStatus: "limited",
            limitedReason: null,
            flagged: [],
          };
          const set = sets[k];
          if (set?.status === "full") return withTests(base, set, null);
          if (!canWrite) return withTests(base, set, "The monthly AI budget is used up");
          try {
            await enqueueTests({ problemId: p.problemId, slug: p.slug });
            return { ...base, testStatus: "writing" };
          } catch (err) {
            console.error("couldn't queue test writing", p.slug, err);
            return withTests(base, set, "Couldn't start writing tests");
          }
        }),
      );

      const t = now();
      const writing = problems.some((p) => p.testStatus === "writing");
      const session: Session = {
        id: newId(),
        createdAt: new Date(t).toISOString(),
        deadline: writing ? null : new Date(t + req.minutes * 60_000).toISOString(),
        preparingSince: writing ? new Date(t).toISOString() : null,
        minutes: req.minutes,
        source: req.source,
        finishedAt: null,
        summary: null,
        count: picked.length,
        problems,
      };
      await store.create(session);
      return json(201, { id: session.id, skipped });
    },

    async get(event: Event): Result {
      let s = await load(event);
      if (!s) return json(404, { error: "No such mock OA" });
      s = await prepare(s);
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
      const refused = closed(s);
      if (refused) return refused;
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
      const refused = closed(s);
      if (refused) return refused;
      const p = s.problems[i];
      if (p.approach) return json(409, { error: "Already locked" });
      const createdAt = iso();
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
      const refused = closed(s);
      if (refused) return refused;
      const p = s.problems[i];
      if (!p.approach) return json(400, { error: "Lock your approach first" });
      const report = await judge(p, code, submit === true);
      const next = submit === true ? submitted(p, code, report) : { ...p, code, last: report };
      const changes = problemChanges(i, next, submit === true ? SUBMIT_FIELDS : ["code", "last"]);
      if (!(await store.update(s.id, changes, true))) return json(409, { error: "Time's up" });
      return json(200, { report, best: next.best, bestReport: next.bestReport });
    },

    // "This test looks wrong" (#17, #63): an AI test stops counting here and in later mock OAs, and the
    // problem is scored again. Works during the test and on Results; flagged: false is Undo.
    async flag(event: Event): Result {
      const s = await load(event);
      if (!s) return json(404, { error: "No such mock OA" });
      const i = problemOf(event, s);
      if (i === null) return json(404, { error: "No such problem" });
      const { testId, flagged } = readBody(event);
      const p = s.problems[i];
      if (typeof testId !== "string" || !p.tests.some((t) => t.id === testId && t.source === "ai")) {
        return json(400, { error: "Only tests written by AI can be flagged" });
      }
      if (typeof flagged !== "boolean") return json(400, { error: "flagged must be true or false" });

      const list = flagged ? [...new Set([...p.flagged, testId])] : p.flagged.filter((t) => t !== testId);
      const bestReport = p.bestReport && rescore(p.bestReport, list);
      const next: SessionProblem = { ...p, flagged: list, bestReport, best: countsOf(bestReport), last: p.last && rescore(p.last, list) };
      const out: Session = structuredClone(s);
      out.problems[i] = next;
      const changes = problemChanges(i, next, ["flagged", "bestReport", "best", "last"]);
      if (out.finishedAt) {
        out.summary = summarize(out, Date.parse(out.finishedAt));
        changes.push([["summary"], out.summary]);
      }
      await store.update(s.id, changes);

      const set = await store.testSet(p.problemId);
      if (set?.status === "full") {
        await store.setFlagged(p.problemId, flagged ? [...new Set([...set.flagged, testId])] : set.flagged.filter((t) => t !== testId));
      }
      return json(200, { session: toView(out, now()) });
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
      if (s.preparingSince) return json(409, { error: "The test hasn't started yet" });
      const { codes } = readBody(event);
      if (!s.finishedAt && Array.isArray(codes) && codes.length === s.problems.length && codes.every((c) => typeof c === "string" && c.length <= MAX_CODE_LENGTH)) {
        const changed = (codes as string[]).map((c, i) => ({ c, i })).filter(({ c, i }) => c !== s!.problems[i].code);
        if (changed.length && s.deadline && now() <= Date.parse(s.deadline) + GRACE_MS) {
          await store.update(s.id, changed.map(({ c, i }): Change => [["problems", i, "code"], c]), true);
          s = normalize((await store.get(s.id))!);
        }
      }
      s = await finish(s);
      return json(200, { session: toView(s, now()) });
    },

    // The problem page's "Mock OA tests" section (#63 D): what exists, what's flagged.
    async testsInfo(event: Event): Result {
      const problemId = problemIdOf(event);
      if (!problemId) return json(400, { error: "problemId required" });
      const set = await store.testSet(problemId);
      if (!set) return json(200, { tests: null });
      const flagged = set.tests
        .filter((t) => set.flagged.includes(t.id))
        .map((t) => ({ id: t.id, large: t.large, input: t.input ?? null }));
      return json(200, {
        tests: {
          status: set.status,
          reason: set.reason ?? null,
          writtenAt: set.writtenAt,
          model: set.model,
          small: set.tests.filter((t) => !t.large).length,
          large: set.tests.filter((t) => t.large).length,
          flagged,
        },
      });
    },

    // Un-flag: the test counts again in later mock OAs; past scores stay as they were.
    async unflag(event: Event): Result {
      const problemId = problemIdOf(event);
      if (!problemId) return json(400, { error: "problemId required" });
      const { testId } = readBody(event);
      const set = await store.testSet(problemId);
      if (!set || typeof testId !== "string" || !set.flagged.includes(testId)) return json(400, { error: "That test isn't flagged" });
      await store.setFlagged(problemId, set.flagged.filter((t) => t !== testId));
      return json(200, { unflagged: testId });
    },

    // Rewrite tests (#63): the AI writes a fresh set in the background and old flags are cleared.
    async rewrite(event: Event): Result {
      const problemId = problemIdOf(event);
      if (!problemId) return json(400, { error: "problemId required" });
      const { slug } = readBody(event);
      if (typeof slug !== "string" || !SLUG.test(slug)) return json(400, { error: "slug required" });
      if (!(await budgetLeft())) return json(409, { error: "The monthly AI budget is used up" });
      await enqueueTests({ problemId, slug, rewrite: true });
      return json(202, { queued: true, at: iso() });
    },
  };
};
