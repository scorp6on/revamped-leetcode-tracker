import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import type { Difficulty } from "./catalog/types";
import { json, readBody } from "./http";
import { SLUG } from "./problems/leetcode";
import { isActive, type PredictionStore } from "./problems/prediction";
import { isLocalDate } from "./review/dates";
import { NEW_STATE, nextReview, qualityFor } from "./review/sm2";
import type { ReviewStore } from "./review/store";
import {
  FAILURE_MODES,
  MAX_MINUTES,
  MAX_NOTES_LENGTH,
  NOTE_SECTIONS,
  OUTCOMES,
  type NoteSection,
  type Attempt,
  type AttemptInput,
  type FailureMode,
  type Schedule,
} from "./review/types";

export interface AttemptDeps {
  reviews: Pick<ReviewStore, "schedule" | "record">;
  predictions: Pick<PredictionStore, "latest">;
  now: () => number;
}

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];
const isInt = (n: unknown, min: number, max: number): n is number =>
  Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

// Returns the cleaned input, or the reason it was refused.
export function parseAttempt(body: Record<string, unknown>): AttemptInput | string {
  const { problemId, slug, title, difficulty, tags, outcome, confidence, minutes, failureMode, localDate } = body;
  if (typeof problemId !== "string" || !/^\d+$/.test(problemId)) return "problemId required";
  if (typeof slug !== "string" || !SLUG.test(slug)) return "slug required";
  if (typeof title !== "string" || !title || title.length > 200) return "title required";
  if (!DIFFICULTIES.includes(difficulty as Difficulty)) return "difficulty required";
  if (!Array.isArray(tags) || tags.length > 30 || !tags.every((t) => typeof t === "string" && SLUG.test(t))) {
    return "tags must be topic slugs";
  }
  if (!OUTCOMES.includes(outcome as Attempt["outcome"])) return "outcome must be solved, struggled or failed";
  if (!isInt(confidence, 1, 5)) return "confidence must be 1–5";
  if (!isInt(minutes, 1, MAX_MINUTES)) return `minutes must be 1–${MAX_MINUTES}`;
  if (failureMode != null && !(typeof failureMode === "string" && failureMode in FAILURE_MODES)) {
    return "unknown failure mode";
  }
  // The Today ranking runs on failure modes, so a rough attempt must say what went wrong (#50).
  if (outcome !== "solved" && failureMode == null) return "failure mode required when you struggled or failed";
  for (const section of Object.keys(NOTE_SECTIONS) as NoteSection[]) {
    const text = body[section];
    if (text != null && (typeof text !== "string" || text.length > MAX_NOTES_LENGTH)) {
      return `${NOTE_SECTIONS[section]} must be at most ${MAX_NOTES_LENGTH} characters`;
    }
  }
  if (!isLocalDate(localDate)) return "localDate must be YYYY-MM-DD";

  return {
    problemId,
    slug,
    title,
    difficulty: difficulty as Difficulty,
    tags: tags as string[],
    outcome: outcome as Attempt["outcome"],
    confidence,
    minutes,
    failureMode: (failureMode ?? null) as FailureMode | null,
    approach: ((body.approach as string | undefined) ?? "").trim(),
    learned: ((body.learned as string | undefined) ?? "").trim(),
    reflection: ((body.reflection as string | undefined) ?? "").trim(),
    localDate,
  };
}

export const makeAttemptHandler =
  ({ reviews, predictions, now }: AttemptDeps) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const input = parseAttempt(readBody(event));
    if (typeof input === "string") return json(400, { error: input });

    const t = now();
    const [current, latest] = await Promise.all([
      reviews.schedule(input.problemId),
      predictions.latest(input.problemId),
    ]);
    // Claims the newest prediction if it's unclaimed and within the lock window (#41, #46).
    const claim = latest && isActive(latest, t) ? latest : undefined;

    const createdAt = new Date(t).toISOString();
    const quality = qualityFor(input.outcome, input.confidence);
    const next = nextReview(current ?? NEW_STATE, quality, input.localDate);
    const attempt: Attempt = { ...input, createdAt, quality, prediction: claim?.text ?? null };
    const failureModes = { ...current?.failureModes };
    if (input.failureMode) failureModes[input.failureMode] = (failureModes[input.failureMode] ?? 0) + 1;
    const schedule: Schedule = {
      problemId: input.problemId,
      slug: input.slug,
      title: input.title,
      difficulty: input.difficulty,
      tags: input.tags,
      ...next,
      attempts: (current?.attempts ?? 0) + 1,
      solved: (current?.solved ?? false) || input.outcome === "solved",
      failureModes,
      lastAttemptAt: createdAt,
    };

    try {
      await reviews.record({ attempt, schedule, claim });
    } catch (err) {
      // e.g. the prediction was claimed by a double-tap a moment earlier.
      if ((err as Error).name === "TransactionCanceledException") {
        return json(409, { error: "Something changed while saving. Try again." });
      }
      throw err;
    }
    return json(201, { attempt, schedule });
  };
