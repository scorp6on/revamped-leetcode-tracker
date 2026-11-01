import { SLUG } from "../problems/leetcode";
import { MAX_CODE_LENGTH, type Submission } from "./types";

const str = (v: unknown, max = 200) => (typeof v === "string" && v.length <= max ? v : undefined);

// Checks one submission sent by the extension; null when anything is off.
export function parseSubmission(raw: unknown): Submission | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 20);
  const slug = str(r.slug);
  const timestamp = r.timestamp;
  if (!id || !/^\d+$/.test(id) || !slug || !SLUG.test(slug)) return null;
  if (!Number.isInteger(timestamp) || (timestamp as number) <= 0) return null;
  if (r.code != null && (typeof r.code !== "string" || r.code.length > MAX_CODE_LENGTH)) return null;
  return {
    id,
    slug,
    title: str(r.title) ?? slug,
    status: str(r.status, 60) ?? "Unknown",
    accepted: r.accepted === true,
    lang: str(r.lang, 40) ?? "",
    runtime: str(r.runtime, 40) ?? null,
    memory: str(r.memory, 40) ?? null,
    timestamp: timestamp as number,
    code: (r.code as string | undefined) ?? null,
    source: "extension",
  };
}

// Nothing from before you connected the extension is imported (#56).
export const sinceConnect = (subs: Submission[], connectedAt: number) =>
  subs.filter((s) => s.timestamp * 1000 >= connectedAt);
