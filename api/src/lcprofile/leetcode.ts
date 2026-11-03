import { LEVELS, type Level, type LeetCodeProfile } from "./types";

const QUERY = `query profile($username: String!) {
  allQuestionsCount { difficulty count }
  matchedUser(username: $username) {
    username
    profile { realName userAvatar }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
}`;

type Counts = { difficulty: string; count: number }[];

// LeetCode's PUBLIC profile query, by username: no cookie needed, like the backup poll (#55, #61).
// Gives up after 5 seconds so the page never waits long.
export const fetchLeetCodeProfile = async (username: string, now: number): Promise<LeetCodeProfile> => {
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", referer: "https://leetcode.com" },
    body: JSON.stringify({ query: QUERY, variables: { username } }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`LeetCode answered ${res.status}`);
  return parseProfile((await res.json())?.data, now);
};

export function parseProfile(data: unknown, now: number): LeetCodeProfile {
  const d = data as {
    allQuestionsCount?: Counts;
    matchedUser?: {
      username: string;
      profile?: { realName?: string; userAvatar?: string };
      submitStatsGlobal?: { acSubmissionNum?: Counts };
    } | null;
  } | null;
  const user = d?.matchedUser;
  if (!user) throw new Error("no public LeetCode profile for that username");
  const count = (list: Counts | undefined, level: Level) => list?.find((c) => c.difficulty === level)?.count ?? 0;
  const solved = Object.fromEntries(
    LEVELS.map((l) => [l, { solved: count(user.submitStatsGlobal?.acSubmissionNum, l), total: count(d?.allQuestionsCount, l) }]),
  ) as LeetCodeProfile["solved"];
  const avatar = user.profile?.userAvatar;
  return {
    username: user.username,
    name: user.profile?.realName?.trim() || user.username,
    avatar: avatar && /^https:\/\//.test(avatar) ? avatar : null, // only ever an https link
    solved,
    fetchedAt: new Date(now).toISOString(),
  };
}
