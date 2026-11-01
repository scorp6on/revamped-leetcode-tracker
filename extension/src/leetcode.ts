// Reads your submissions from LeetCode inside your own browser (#55): logged in, on your home
// connection, so Cloudflare lets it through where AWS is blocked.
import type { Submission } from "../../api/src/sync/types";

const ORIGIN = "https://leetcode.com";
const PAGE = 20;
const MAX_PAGES = 5; // a sync never reads more than 100 back

type Sent = Omit<Submission, "source">;

// One row of /api/submissions/ (the history request; includes your code).
export interface RestRow {
  id: number;
  title: string;
  title_slug: string;
  status_display: string;
  lang: string;
  runtime: string;
  memory: string;
  timestamp: number;
  code: string;
  is_pending?: string; // "Not Pending" once judged
}

// Rows LeetCode is still judging are left for the next sync: saved now, their status would stick.
export const judged = (rows: RestRow[]) => rows.filter((r) => !r.is_pending || r.is_pending === "Not Pending");

// One row of GraphQL submissionList (the fallback; no code).
export interface GraphqlRow {
  id: string;
  title: string;
  titleSlug: string;
  statusDisplay: string;
  lang: string;
  runtime: string;
  memory: string;
  timestamp: string;
}

export const fromRest = (r: RestRow): Sent => ({
  id: String(r.id),
  slug: r.title_slug,
  title: r.title,
  status: r.status_display,
  accepted: r.status_display === "Accepted",
  lang: r.lang,
  runtime: r.runtime || null,
  memory: r.memory || null,
  timestamp: Number(r.timestamp),
  code: r.code ?? null,
});

export const fromGraphql = (r: GraphqlRow): Sent => ({
  id: r.id,
  slug: r.titleSlug,
  title: r.title,
  status: r.statusDisplay,
  accepted: r.statusDisplay === "Accepted",
  lang: r.lang,
  runtime: r.runtime || null,
  memory: r.memory || null,
  timestamp: Number(r.timestamp),
  code: null,
});

// Newest-first rows → the ones newer than the last one already sent. `done` = reached it.
export function newerThan(rows: Sent[], lastSeenId: string | null) {
  if (lastSeenId === null) return { fresh: rows, done: true }; // first sync: just the latest page
  const i = rows.findIndex((r) => BigInt(r.id) <= BigInt(lastSeenId));
  return i === -1 ? { fresh: rows, done: false } : { fresh: rows.slice(0, i), done: true };
}

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${ORIGIN}/graphql`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.data) throw new Error(`LeetCode answered ${res.status}`);
  return body.data as T;
}

export async function whoAmI(): Promise<{ signedIn: boolean; username: string | null }> {
  const { userStatus } = await graphql<{ userStatus: { isSignedIn: boolean; username: string } }>(
    "{ userStatus { isSignedIn username } }",
  );
  return { signedIn: userStatus.isSignedIn, username: userStatus.username || null };
}

async function restPage(offset: number): Promise<Sent[]> {
  const res = await fetch(`${ORIGIN}/api/submissions/?offset=${offset}&limit=${PAGE}`, { credentials: "include" });
  const body = await res.json().catch(() => null); // a Cloudflare page isn't JSON
  if (!res.ok || !Array.isArray(body?.submissions_dump)) throw new Error(`history request answered ${res.status}`);
  return judged(body.submissions_dump as RestRow[]).map(fromRest);
}

const LIST = `query list($offset: Int!, $limit: Int!) {
  submissionList(offset: $offset, limit: $limit) {
    submissions { id title titleSlug statusDisplay lang runtime memory timestamp }
  }
}`;

async function graphqlPage(offset: number): Promise<Sent[]> {
  const data = await graphql<{ submissionList: { submissions: GraphqlRow[] } }>(LIST, { offset, limit: PAGE });
  return data.submissionList.submissions.map(fromGraphql);
}

// Your submissions newer than lastSeenId, newest first. The history request first (it has your code);
// if LeetCode answers that with a block page, the GraphQL list the site itself uses.
export async function readNewSubmissions(lastSeenId: string | null): Promise<{ subs: Sent[]; via: "history" | "graphql" }> {
  for (const [via, page] of [["history", restPage], ["graphql", graphqlPage]] as const) {
    try {
      const subs: Sent[] = [];
      for (let p = 0; p < MAX_PAGES; p++) {
        const rows = await page(p * PAGE);
        const { fresh, done } = newerThan(rows, lastSeenId);
        subs.push(...fresh);
        if (done || rows.length < PAGE) break;
      }
      return { subs, via };
    } catch (err) {
      if (via === "graphql") throw err;
    }
  }
  throw new Error("unreachable");
}
