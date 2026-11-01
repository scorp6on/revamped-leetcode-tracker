import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { json, readBody } from "./http";
import { parseSubmission, sinceConnect } from "./sync/parse";
import { dynamoSyncStore, type SyncStore } from "./sync/store";
import { tokenMatches } from "./sync/token";
import { MAX_SUBMISSIONS_PER_POST, type Submission } from "./sync/types";

export interface IngestDeps {
  store: Pick<SyncStore, "state" | "updateState" | "saveSubmissions">;
  now: () => number;
}

// POST /api/ext/sync: the extension's report (#55, #56). A public route: the extension has no login
// cookie, so this Lambda checks its token itself.
export const makeIngestHandler =
  ({ store, now }: IngestDeps) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const bearer = event.headers?.authorization?.match(/^Bearer (\S+)$/)?.[1];
    const state = await store.state();
    if (!bearer || !state.tokenHash || !tokenMatches(bearer, state.tokenHash)) {
      return json(401, { error: "unknown extension token; pair it again from the app" });
    }

    const body = readBody(event);
    const raw = body.submissions ?? [];
    if (!Array.isArray(raw) || raw.length > MAX_SUBMISSIONS_PER_POST) {
      return json(400, { error: `submissions must be a list of at most ${MAX_SUBMISSIONS_PER_POST}` });
    }
    const parsed = raw.map(parseSubmission);
    if (parsed.some((s) => s === null)) return json(400, { error: "a submission is malformed" });

    const fresh = sinceConnect(parsed as Submission[], state.connectedAt ?? now());
    const saved = await store.saveSubmissions(fresh);
    await store.updateState({
      lastExtensionSync: now(),
      signedIn: typeof body.signedIn === "boolean" ? body.signedIn : null,
      ...(typeof body.username === "string" && body.username ? { username: body.username } : {}),
      lastError: typeof body.error === "string" ? body.error.slice(0, 300) : null,
    });
    return json(200, { received: raw.length, saved });
  };

export const handler = makeIngestHandler({ store: dynamoSyncStore(process.env.TABLE_NAME ?? ""), now: Date.now });
