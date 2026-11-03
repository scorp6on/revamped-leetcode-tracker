import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { json } from "../http";
import type { LcProfileStore } from "./store";
import { REFRESH_MS, type LeetCodeProfile, type LeetCodeProfileResponse } from "./types";

export interface LcProfileDeps {
  username: () => Promise<string | null | undefined>; // reported by the extension (#56)
  store: LcProfileStore;
  fetchProfile: (username: string, now: number) => Promise<LeetCodeProfile>;
  now: () => number;
}

// GET /api/leetcode-profile (#61): the saved copy if it's under a day old, otherwise a fresh one
// from LeetCode; if LeetCode fails, the last saved copy marked stale.
export const makeLcProfileHandler =
  ({ username, store, fetchProfile, now }: LcProfileDeps) =>
  async (): Promise<APIGatewayProxyResultV2> => {
    const name = await username();
    if (!name) return json(200, { username: null, profile: null, stale: false } satisfies LeetCodeProfileResponse);
    const saved = await store.saved();
    const same = saved && saved.username.toLowerCase() === name.toLowerCase() ? saved : undefined;
    if (same && now() - Date.parse(same.fetchedAt) < REFRESH_MS) {
      return json(200, { username: name, profile: same, stale: false } satisfies LeetCodeProfileResponse);
    }
    try {
      const fresh = await fetchProfile(name, now());
      await store.save(fresh);
      return json(200, { username: name, profile: fresh, stale: false } satisfies LeetCodeProfileResponse);
    } catch (err) {
      console.error("LeetCode profile fetch failed", err);
      return json(200, { username: name, profile: same ?? null, stale: !!same } satisfies LeetCodeProfileResponse);
    }
  };
