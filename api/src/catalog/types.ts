// The shape of /data/catalog.json, shared by the Catalog Lambda (writer) and the web app (reader).

export type Difficulty = "Easy" | "Medium" | "Hard";

export interface CatalogEntry {
  id: string; // LeetCode's frontend number, e.g. "1"
  title: string;
  slug: string;
  difficulty: Difficulty;
  ac: number; // acceptance rate in %, one decimal
  paid: boolean; // Premium-only
  tags: string[]; // topic slugs; names live in Catalog.tags
}

export interface Catalog {
  generatedAt: string; // ISO time the Lambda built it
  tags: Record<string, string>; // slug → display name
  problems: CatalogEntry[];
}
