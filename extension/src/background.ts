// The extension's service worker (#55, #56): syncs every 15 minutes, ~10 s after you submit on
// LeetCode, and when the app's Sync now asks.
import { MAX_SUBMISSIONS_PER_POST } from "../../api/src/sync/types";
import { readNewSubmissions, whoAmI } from "./leetcode";

export interface Config {
  server?: string; // which lc/tracker site to send to (prod or dev)
  token?: string; // from the app's Connect extension
  lastSeenId?: string | null; // newest submission already sent
  lastSync?: number;
  lastError?: string | null;
  lastVia?: "history" | "graphql";
}

export type SyncResult = { ok: true; sent: number } | { ok: false; error: string };

const ALARM = "sync";

const setBadge = (error: boolean) => {
  void chrome.action.setBadgeText({ text: error ? "!" : "" });
  if (error) void chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
};

async function post(cfg: Config, body: unknown) {
  const res = await fetch(`${cfg.server}/api/ext/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("The tracker didn't recognise this token. Connect the extension again from the app.");
  if (!res.ok) throw new Error(`The tracker answered ${res.status}`);
}

async function runSync(): Promise<SyncResult> {
  const cfg = (await chrome.storage.local.get(null)) as Config;
  if (!cfg.server || !cfg.token) return { ok: false, error: "Not connected yet. Open the options and paste a token." };
  let signedIn: boolean | null = null;
  try {
    const me = await whoAmI();
    signedIn = me.signedIn;
    if (!me.signedIn) {
      // Not an extension error: the app shows "log in to LeetCode in Chrome".
      await post(cfg, { signedIn: false });
      await chrome.storage.local.set({ lastSync: Date.now(), lastError: null });
      setBadge(false);
      return { ok: true, sent: 0 };
    }
    const { subs, via } = await readNewSubmissions(cfg.lastSeenId ?? null);
    // Oldest first, in batches. Always at least one post, so the tracker learns you're signed in and
    // your username (the backup poll needs it). If a batch fails, lastSeenId isn't moved and the next
    // sync resends; the tracker skips repeats by submission ID.
    const ordered = [...subs].reverse();
    for (let i = 0; i === 0 || i < ordered.length; i += MAX_SUBMISSIONS_PER_POST) {
      await post(cfg, { signedIn: true, username: me.username, submissions: ordered.slice(i, i + MAX_SUBMISSIONS_PER_POST) });
    }
    await chrome.storage.local.set({
      lastSeenId: subs[0]?.id ?? cfg.lastSeenId ?? null,
      lastSync: Date.now(),
      lastError: null,
      lastVia: via,
    });
    setBadge(false);
    return { ok: true, sent: subs.length };
  } catch (err) {
    const error = (err as Error).message;
    await chrome.storage.local.set({ lastError: error });
    setBadge(true);
    // Tell the app too, so the error shows there (best effort: the tracker may be what failed).
    await post(cfg, { signedIn, error }).catch(() => {});
    return { ok: false, error };
  }
}

// One sync at a time: a timer, a submit and Sync now can all arrive together.
let running: Promise<SyncResult> | null = null;
export const sync = () => (running ??= runSync().finally(() => (running = null)));

const schedule = () => chrome.alarms.create(ALARM, { periodInMinutes: 15 });
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void sync();
});

// Right after a submit: LeetCode needs a few seconds to judge it before it shows in your history.
chrome.webRequest.onCompleted.addListener(
  (d) => {
    if (d.method === "POST") setTimeout(() => void sync(), 10_000);
  },
  { urls: ["https://leetcode.com/problems/*/submit/"] },
);

// Sync now, from the app (only our two sites may send this) or from the options page.
const onSyncRequest = (msg: unknown, _sender: unknown, reply: (r: SyncResult) => void) => {
  if ((msg as { type?: string })?.type !== "sync") return false;
  void sync().then(reply);
  return true; // reply comes later
};
chrome.runtime.onMessageExternal.addListener(onSyncRequest);
chrome.runtime.onMessage.addListener(onSyncRequest);

chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());
