import { describe, expect, it } from "vitest";
import { parseProfile } from "./leetcode";
import { makeLcProfileHandler } from "./route";
import type { LeetCodeProfile } from "./types";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const HOUR = 3600_000;

const profile = (over: Partial<LeetCodeProfile> = {}): LeetCodeProfile => ({
  username: "scorp6on",
  name: "scorp6on",
  avatar: "https://assets.leetcode.com/users/scorp6on/avatar.png",
  solved: {
    All: { solved: 3, total: 4100 },
    Easy: { solved: 2, total: 975 },
    Medium: { solved: 1, total: 2138 },
    Hard: { solved: 0, total: 987 },
  },
  fetchedAt: new Date(NOW).toISOString(),
  ...over,
});

const setup = ({
  username = "scorp6on" as string | null,
  saved = undefined as LeetCodeProfile | undefined,
  fetched = profile() as LeetCodeProfile | Error,
} = {}) => {
  const calls = { fetch: 0, saved: [] as LeetCodeProfile[] };
  const handler = makeLcProfileHandler({
    username: async () => username,
    store: { saved: async () => saved, save: async (p) => void calls.saved.push(p) },
    fetchProfile: async () => {
      calls.fetch++;
      if (fetched instanceof Error) throw fetched;
      return fetched;
    },
    now: () => NOW,
  });
  const get = async () => JSON.parse(((await handler()) as { body: string }).body);
  return { get, calls };
};

describe("GET /api/leetcode-profile", () => {
  it("has nothing to show until the extension reports a username", async () => {
    const { get, calls } = setup({ username: null });
    expect(await get()).toEqual({ username: null, profile: null, stale: false });
    expect(calls.fetch).toBe(0);
  });

  it("uses the saved copy while it's under a day old", async () => {
    const saved = profile({ fetchedAt: new Date(NOW - 23 * HOUR).toISOString() });
    const { get, calls } = setup({ saved });
    expect(await get()).toEqual({ username: "scorp6on", profile: saved, stale: false });
    expect(calls.fetch).toBe(0);
  });

  it("refreshes from LeetCode once the saved copy is a day old, and saves it", async () => {
    const saved = profile({ fetchedAt: new Date(NOW - 25 * HOUR).toISOString() });
    const { get, calls } = setup({ saved });
    expect((await get()).profile.fetchedAt).toBe(new Date(NOW).toISOString());
    expect(calls.fetch).toBe(1);
    expect(calls.saved).toHaveLength(1);
  });

  it("refreshes when the username changed", async () => {
    const { calls, get } = setup({ username: "someone-else", saved: profile() });
    await get();
    expect(calls.fetch).toBe(1);
  });

  it("falls back to the last saved copy, marked stale, when LeetCode fails", async () => {
    const saved = profile({ fetchedAt: new Date(NOW - 48 * HOUR).toISOString() });
    expect(await setup({ saved, fetched: new Error("down") }).get()).toEqual({ username: "scorp6on", profile: saved, stale: true });
    expect(await setup({ fetched: new Error("down") }).get()).toEqual({ username: "scorp6on", profile: null, stale: false });
  });
});

describe("parsing LeetCode's answer", () => {
  const data = {
    allQuestionsCount: [
      { difficulty: "All", count: 4100 },
      { difficulty: "Easy", count: 975 },
      { difficulty: "Medium", count: 2138 },
      { difficulty: "Hard", count: 987 },
    ],
    matchedUser: {
      username: "scorp6on",
      profile: { realName: "  ", userAvatar: "https://assets.leetcode.com/a.png" },
      submitStatsGlobal: { acSubmissionNum: [{ difficulty: "All", count: 3 }, { difficulty: "Easy", count: 2 }, { difficulty: "Medium", count: 1 }] },
    },
  };

  it("reads solved counts out of all problems, and uses the username when no name is set", () => {
    const p = parseProfile(data, NOW);
    expect(p.name).toBe("scorp6on");
    expect(p.solved.All).toEqual({ solved: 3, total: 4100 });
    expect(p.solved.Hard).toEqual({ solved: 0, total: 987 });
  });

  it("keeps only https picture links, and rejects an unknown user", () => {
    const bad = { ...data, matchedUser: { ...data.matchedUser, profile: { userAvatar: "javascript:alert(1)" } } };
    expect(parseProfile(bad, NOW).avatar).toBeNull();
    expect(() => parseProfile({ ...data, matchedUser: null }, NOW)).toThrow();
  });
});
