import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { makeBackupHandler, toSubmission, type RecentAccepted } from "../backup";
import { makeIngestHandler } from "../ingest";
import { makeSyncRoutes } from "./routes";
import type { SyncStore } from "./store";
import { hashToken, newToken, tokenMatches } from "./token";
import type { Submission, SyncState } from "./types";

const NOW = Date.parse("2026-10-30T20:00:00Z");
const CONNECTED = Date.parse("2026-10-30T12:00:00Z");
const TOKEN = "ext-token-123";

// An in-memory SyncStore: dedupes by id like the real conditional write.
const fakeStore = (initial: SyncState = {}) => {
  let state = { ...initial };
  const subs = new Map<string, Submission>();
  const store: SyncStore = {
    state: async () => ({ ...state }),
    updateState: async (patch) => void (state = { ...state, ...patch }),
    saveSubmissions: async (list) => {
      let saved = 0;
      for (const s of list) {
        const had = subs.get(s.id);
        if (!had) {
          subs.set(s.id, s);
          saved += 1;
        } else if (had.source === "public" && s.source === "extension") subs.set(s.id, s);
      }
      return saved;
    },
    pendingCount: async () => subs.size,
  };
  return { store, state: () => state, subs };
};

const sub = (id: string, at: number, extra: Partial<Submission> = {}) => ({
  id,
  slug: "two-sum",
  title: "Two Sum",
  status: "Accepted",
  accepted: true,
  lang: "python3",
  runtime: "52 ms",
  memory: "17 MB",
  timestamp: Math.floor(at / 1000),
  code: "class Solution: ...",
  ...extra,
});

const ingestEvent = (body: unknown, token: string | null = TOKEN) =>
  ({ headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEventV2;

describe("token", () => {
  it("matches only the token whose hash was stored", () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes
    expect(tokenMatches(t, hashToken(t))).toBe(true);
    expect(tokenMatches(t + "x", hashToken(t))).toBe(false);
    expect(tokenMatches(t, "not-hex")).toBe(false);
  });
});

describe("POST /api/ext/sync (ingest)", () => {
  const setup = () => {
    const f = fakeStore({ tokenHash: hashToken(TOKEN), connectedAt: CONNECTED });
    const ingest = makeIngestHandler({ store: f.store, now: () => NOW });
    const call = async (body: unknown, token?: string | null) => {
      const res = (await ingest(ingestEvent(body, token))) as { statusCode: number; body: string };
      return { statusCode: res.statusCode, body: JSON.parse(res.body) };
    };
    return { ...f, call };
  };

  it("refuses a missing or wrong token", async () => {
    const { call, subs } = setup();
    expect((await call({ submissions: [sub("1", NOW)] }, null)).statusCode).toBe(401);
    expect((await call({ submissions: [sub("1", NOW)] }, "guess")).statusCode).toBe(401);
    expect(subs.size).toBe(0);
  });

  it("saves new submissions once, skipping ones from before you connected", async () => {
    const { call, subs, state } = setup();
    const res = await call({ signedIn: true, username: "me", submissions: [sub("1", NOW), sub("2", CONNECTED - 1000)] });
    expect(res.body).toEqual({ received: 2, saved: 1 });
    expect([...subs.keys()]).toEqual(["1"]);
    expect((await call({ signedIn: true, submissions: [sub("1", NOW)] })).body.saved).toBe(0); // dedupe
    expect(state()).toMatchObject({ lastExtensionSync: NOW, signedIn: true, username: "me", lastError: null });
  });

  it("records a logged-out browser and the extension's error", async () => {
    const { call, state } = setup();
    await call({ signedIn: false, error: "LeetCode blocked the request" });
    expect(state()).toMatchObject({ signedIn: false, lastError: "LeetCode blocked the request" });
  });

  it("rejects malformed or oversized reports", async () => {
    const { call } = setup();
    expect((await call({ submissions: [sub("x1", NOW)] })).statusCode).toBe(400);
    expect((await call({ submissions: [sub("1", NOW, { slug: "Two Sum" })] })).statusCode).toBe(400);
    expect((await call({ submissions: [sub("1", NOW, { code: "x".repeat(64 * 1024 + 1) })] })).statusCode).toBe(400);
    expect((await call({ submissions: Array.from({ length: 101 }, (_, i) => sub(String(i), NOW)) })).statusCode).toBe(400);
  });
});

describe("backup poll", () => {
  const recent: RecentAccepted[] = [
    { id: "10", title: "Two Sum", titleSlug: "two-sum", timestamp: String(Math.floor(NOW / 1000)) },
    { id: "9", title: "Old", titleSlug: "old", timestamp: String(Math.floor((CONNECTED - 1000) / 1000)) },
  ];

  it("waits until the extension has reported your username", async () => {
    const f = fakeStore({ tokenHash: "h", connectedAt: CONNECTED });
    const run = makeBackupHandler({ store: f.store, fetchRecent: async () => recent, now: () => NOW });
    expect(await run()).toEqual({ skipped: "not connected yet" });
  });

  it("saves recent accepted solves since you connected, marked as having no code", async () => {
    const f = fakeStore({ tokenHash: "h", connectedAt: CONNECTED, username: "me" });
    const run = makeBackupHandler({ store: f.store, fetchRecent: async () => recent, now: () => NOW });
    expect(await run()).toEqual({ seen: 2, saved: 1 });
    expect(f.subs.get("10")).toMatchObject({ source: "public", code: null, accepted: true });
    expect(f.state().lastPublicSync).toBe(NOW);
  });

  it("lets the extension's full copy fill in a backup record", async () => {
    const f = fakeStore();
    await f.store.saveSubmissions([toSubmission(recent[0])]);
    await f.store.saveSubmissions([{ ...sub("10", NOW), source: "extension" }]);
    expect(f.subs.get("10")).toMatchObject({ source: "extension", code: "class Solution: ..." });
  });
});

describe("sync routes", () => {
  const setup = (initial: SyncState = {}) => {
    const f = fakeStore(initial);
    let clock = NOW;
    let backups = 0;
    const routes = makeSyncRoutes({
      store: f.store,
      runBackup: async () => void (backups += 1),
      newToken: () => TOKEN,
      now: () => clock,
    });
    const body = async (p: Promise<unknown>) => {
      const res = (await p) as { statusCode: number; body: string };
      return { statusCode: res.statusCode, body: JSON.parse(res.body) };
    };
    return { ...f, routes, body, backups: () => backups, advance: (ms: number) => void (clock += ms) };
  };

  it("pairing returns the token once and stores only its hash; re-pairing keeps the start time", async () => {
    const t = setup();
    expect((await t.body(t.routes.pair())).body).toEqual({ token: TOKEN });
    expect(t.state()).toEqual({ tokenHash: hashToken(TOKEN), connectedAt: NOW });
    t.advance(60_000);
    await t.routes.pair();
    expect(t.state().connectedAt).toBe(NOW);
  });

  it("reports status from both sources", async () => {
    const t = setup({ tokenHash: "h", lastExtensionSync: NOW - 5000, lastPublicSync: NOW - 1000, signedIn: true });
    await t.store.saveSubmissions([{ ...sub("1", NOW), source: "extension" }]);
    expect((await t.body(t.routes.status())).body).toEqual({
      connected: true, pending: 1, lastSyncAt: NOW - 1000, extensionLastSeen: NOW - 5000, signedIn: true, lastError: null,
    });
  });

  it("Sync now runs the backup poll, at most once a minute", async () => {
    const t = setup();
    expect((await t.body(t.routes.syncNow())).statusCode).toBe(202);
    const again = await t.body(t.routes.syncNow());
    expect(again.statusCode).toBe(429);
    expect(again.body.retryAfterSeconds).toBe(60);
    t.advance(60_000);
    expect((await t.body(t.routes.syncNow())).statusCode).toBe(202);
    expect(t.backups()).toBe(2);
  });
});
