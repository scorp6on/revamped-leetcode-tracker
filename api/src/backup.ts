import { sinceConnect } from "./sync/parse";
import { dynamoSyncStore, type SyncStore } from "./sync/store";
import type { Submission } from "./sync/types";

export interface RecentAccepted {
  id: string;
  title: string;
  titleSlug: string;
  timestamp: string; // unix seconds, as a string
}

const QUERY = `query recent($username: String!, $limit: Int!) {
  recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp }
}`;

// LeetCode's PUBLIC recent-accepted list: works from AWS without a cookie, unlike your history
// (tested 2026-10-30, #55). Accepted only, about the last 20, no code.
export const fetchRecentAccepted = async (username: string): Promise<RecentAccepted[]> => {
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", referer: "https://leetcode.com" },
    body: JSON.stringify({ query: QUERY, variables: { username, limit: 20 } }),
  });
  if (!res.ok) throw new Error(`LeetCode answered ${res.status}`);
  const list = (await res.json())?.data?.recentAcSubmissionList;
  if (!Array.isArray(list)) throw new Error(`no public submissions for ${username}`);
  return list;
};

export const toSubmission = (r: RecentAccepted): Submission => ({
  id: r.id,
  slug: r.titleSlug,
  title: r.title,
  status: "Accepted",
  accepted: true,
  lang: "",
  runtime: null,
  memory: null,
  timestamp: Number(r.timestamp),
  code: null,
  source: "public",
});

export interface BackupDeps {
  store: Pick<SyncStore, "state" | "updateState" | "saveSubmissions">;
  fetchRecent: (username: string) => Promise<RecentAccepted[]>;
  now: () => number;
}

// The backup poll (#55): every 15 min on prod, and on Sync now. Catches accepted solves while
// Chrome is closed (e.g. from your phone); the extension fills in their code later.
export const makeBackupHandler =
  ({ store, fetchRecent, now }: BackupDeps) =>
  async () => {
    const state = await store.state();
    // The extension reports your username on its first sync; until then there's nothing to poll.
    if (!state.username || !state.connectedAt) return { skipped: "not connected yet" };
    const recent = await fetchRecent(state.username);
    const saved = await store.saveSubmissions(sinceConnect(recent.map(toSubmission), state.connectedAt));
    await store.updateState({ lastPublicSync: now() });
    return { seen: recent.length, saved };
  };

export const handler = makeBackupHandler({
  store: dynamoSyncStore(process.env.TABLE_NAME ?? ""),
  fetchRecent: fetchRecentAccepted,
  now: Date.now,
});
