import type { Catalog, CatalogEntry, Difficulty } from "./types";

// LeetCode's public GraphQL API is unofficial, so everything it returns is checked before use.
export interface LeetCodeQuestion {
  frontendQuestionId: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  acRate: number;
  paidOnly: boolean;
  topicTags: { name: string; slug: string }[];
}

const DIFFICULTIES = new Set(["Easy", "Medium", "Hard"]);

export const toEntry = (q: LeetCodeQuestion): CatalogEntry => {
  if (!q.frontendQuestionId || !q.title || !q.titleSlug || !DIFFICULTIES.has(q.difficulty)) {
    throw new Error(`unexpected question shape: ${JSON.stringify(q).slice(0, 200)}`);
  }
  return {
    id: q.frontendQuestionId,
    title: q.title,
    slug: q.titleSlug,
    difficulty: q.difficulty as Difficulty,
    ac: Math.round(q.acRate * 10) / 10,
    paid: q.paidOnly === true,
    tags: q.topicTags.map((t) => t.slug),
  };
};

export const buildCatalog = (questions: LeetCodeQuestion[], total: number, now = new Date()): Catalog => {
  // A big shortfall means LeetCode changed or failed; refuse rather than overwrite a good catalog.
  if (total === 0 || questions.length < total * 0.95) {
    throw new Error(`only got ${questions.length} of ${total} problems; keeping the existing catalog`);
  }
  const tags: Record<string, string> = {};
  for (const q of questions) for (const t of q.topicTags) tags[t.slug] = t.name;
  return { generatedAt: now.toISOString(), tags, problems: questions.map(toEntry) };
};
