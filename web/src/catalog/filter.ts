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

// The search, filters, sort and page live in the URL (?q=…&d=Easy,Hard&page=2), so going back
// from a problem page returns to the same view. Defaults are left out to keep links short.
export const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];
const STATUSES: Status[] = ["not-attempted", "attempted", "solved"];
const SORTS: SortKey[] = ["id", "difficulty", "ac"];

export function fromParams(params: URLSearchParams): { query: CatalogQuery; page: number } {
  const pick = <T extends string>(value: string | null, allowed: T[], fallback: T) =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const page = Number(params.get("page"));
  return {
    query: {
      text: params.get("q") ?? "",
      difficulties: DIFFICULTIES.filter((d) => (params.get("d") ?? "").split(",").includes(d)),
      tag: params.get("tag") ?? "",
      status: pick(params.get("status"), STATUSES, ""),
      sort: pick(params.get("sort"), SORTS, "id"),
      descending: params.get("desc") === "1",
    },
    page: Number.isInteger(page) && page > 1 ? page - 1 : 0,
  };
}

export function toParams(q: CatalogQuery, page: number): URLSearchParams {
  const params = new URLSearchParams();
  if (q.text) params.set("q", q.text);
  if (q.difficulties.length) params.set("d", q.difficulties.join(","));
  if (q.tag) params.set("tag", q.tag);
  if (q.status) params.set("status", q.status);
  if (q.sort !== "id") params.set("sort", q.sort);
  if (q.descending) params.set("desc", "1");
  if (page > 0) params.set("page", String(page + 1));
  return params;
}
