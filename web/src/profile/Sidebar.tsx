import type { LeetCodeProfileResponse } from "../../../api/src/lcprofile/types";
import { Avatar } from "../components/Avatar";

const DIFFS = ["Easy", "Medium", "Hard"] as const;
const BAR = { Easy: "bg-easy", Medium: "bg-medium", Hard: "bg-hard" } as const;
const TEXT = { Easy: "text-easy", Medium: "text-medium", Hard: "text-hard" } as const;

const longDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
const n = (x: number) => x.toLocaleString();

export interface Tile {
  label: string;
  value: string;
  note: string;
}

// The Profile sidebar (#61): your LeetCode picture and solved counts, then the streak tiles.
export function Sidebar({ lc, first, tiles }: { lc: LeetCodeProfileResponse | null | "loading"; first: string | null; tiles: Tile[] }) {
  const data = typeof lc === "object" ? lc : null;
  const profile = data?.profile ?? null;
  const username = data?.username ?? null;

  return (
    <aside className="flex flex-col gap-4">
      <div className="flex items-center gap-3.5 md:flex-col md:items-start">
        <Avatar src={profile?.avatar} name={profile?.name ?? username} className="size-16 text-2xl md:size-24 md:text-[34px]" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-xl font-semibold tracking-tight">{profile?.name ?? username ?? "Your profile"}</span>
          {username && (
            <a
              href={`https://leetcode.com/u/${encodeURIComponent(username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-[13px] text-muted-foreground hover:text-foreground"
            >
              @{username} on LeetCode ↗
            </a>
          )}
          {first && <span className="text-[13px] text-muted-foreground">Tracking since {longDate(first)}</span>}
        </div>
      </div>

      {data && !username && (
        <p className="rounded-[10px] border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
          Pair the extension to show your LeetCode profile.
        </p>
      )}

      {profile && (
        <section className="flex flex-col gap-3 rounded-[10px] border p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Solved on LeetCode</h2>
            <span className="text-xs text-muted-foreground">
              {data?.stale ? `as of ${new Date(profile.fetchedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "public profile"}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[26px] font-semibold tabular-nums">{n(profile.solved.All.solved)}</span>
            <span className="text-[13px] text-muted-foreground">of {n(profile.solved.All.total)}</span>
          </div>
          {DIFFS.map((d) => {
            const { solved, total } = profile.solved[d];
            return (
              <div key={d} className="flex flex-col gap-1">
                <div className="flex justify-between text-[13px]">
                  <span className={`font-medium ${TEXT[d]}`}>{d}</span>
                  <span className="text-muted-foreground tabular-nums">
                    <span className="text-foreground">{n(solved)}</span> / {n(total)}
                  </span>
                </div>
                <span className="h-1.5 overflow-hidden rounded-full bg-subtle">
                  <span
                    className={`block h-full rounded-full ${BAR[d]}`}
                    style={{ width: `${total ? Math.max(solved ? 2 : 0, (solved / total) * 100) : 0}%` }}
                  />
                </span>
              </div>
            );
          })}
        </section>
      )}

      <section aria-label="Streaks" className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col rounded-[10px] border px-3 py-2.5">
            <span className="text-xs text-muted-foreground">{t.label}</span>
            <span className="text-[22px] font-semibold tracking-tight tabular-nums">{t.value}</span>
            <span className="text-[11px] text-muted-foreground">{t.note}</span>
          </div>
        ))}
      </section>
    </aside>
  );
}
