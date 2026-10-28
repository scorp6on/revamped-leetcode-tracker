import type { Problem } from "./types";

// LeetCode slugs look like "two-sum": lowercase letters and digits joined by single dashes.
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const QUERY = `query q($slug: String!) {
  question(titleSlug: $slug) {
    id: questionFrontendId
    title
    slug: titleSlug
    difficulty
    paid: isPaidOnly
    content
    tags: topicTags { name slug }
  }
}`;

// The browser can't call LeetCode itself (CORS), so the Problem Lambda does it. null = no such problem.
export const fetchProblem = async (slug: string): Promise<Problem | null> => {
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", referer: `https://leetcode.com/problems/${slug}/` },
    body: JSON.stringify({ query: QUERY, variables: { slug } }),
  });
  if (!res.ok) throw new Error(`LeetCode answered ${res.status} for ${slug}`);
  const data = (await res.json())?.data;
  if (!data || !("question" in data)) throw new Error(`unexpected response for ${slug}`);
  return data.question;
};
