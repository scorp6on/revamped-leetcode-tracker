import type { CatalogEntry, Difficulty } from "../../../api/src/catalog/types";

export type Status = "not-attempted" | "attempted" | "solved";
export type SortKey = "id" | "difficulty" | "ac";

export interface CatalogQuery {
  text: string;
  difficulties: Difficulty[]; // empty = any
  tag: string; // "" = any
  status: Status | ""; // "" = any
  sort: SortKey;
  descending: boolean;
}

export const emptyQuery: CatalogQuery = {
  text: "",
  difficulties: [],
  tag: "",
  status: "",
  sort: "id",
  descending: false,
};

const RANK: Record<Difficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };

// Statuses come from your attempts (M4); until then every problem is "not-attempted".
export function filterCatalog(
  problems: CatalogEntry[],
  q: CatalogQuery,
  statusOf: (slug: string) => Status = () => "not-attempted",
) {
  const text = q.text.trim().toLowerCase();
  const matches = problems.filter(
    (p) =>
      (!text || p.title.toLowerCase().includes(text) || p.id === text.replace(/^#/, "")) &&
      (q.difficulties.length === 0 || q.difficulties.includes(p.difficulty)) &&
      (!q.tag || p.tags.includes(q.tag)) &&
      (!q.status || statusOf(p.slug) === q.status),
  );

  const key = (p: CatalogEntry) =>
    q.sort === "difficulty" ? RANK[p.difficulty] : q.sort === "ac" ? p.ac : Number(p.id);
  // Ties fall back to problem number so the order is stable.
  return matches.sort((a, b) => (key(a) - key(b) || Number(a.id) - Number(b.id)) * (q.descending ? -1 : 1));
}

export const PAGE_SIZE = 50;

export const pageOf = <T,>(rows: T[], page: number) => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
