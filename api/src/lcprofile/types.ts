// Your public LeetCode profile for the Profile sidebar and header (#61). Type-only, no runtime deps.

export const LEVELS = ["All", "Easy", "Medium", "Hard"] as const;
export type Level = (typeof LEVELS)[number];

// Stored as LCPROFILE / PROFILE, refreshed at most once a day.
export interface LeetCodeProfile {
  username: string;
  name: string; // your display name if set, else the username
  avatar: string | null; // an image URL on LeetCode's servers
  solved: Record<Level, { solved: number; total: number }>; // totals include Premium problems
  fetchedAt: string; // ISO time
}

export interface LeetCodeProfileResponse {
  username: string | null; // null until the extension has reported it
  profile: LeetCodeProfile | null;
  stale: boolean; // LeetCode couldn't be reached, so this is the last saved copy
}

export const REFRESH_MS = 24 * 3600_000;
