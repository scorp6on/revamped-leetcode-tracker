import { useCallback, useEffect, useState } from "react";
import type { SyncStatus } from "../../../api/src/sync/types";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { usePending } from "../pending/PendingContext";
import { askExtensionToSync } from "./extension";

const POLL_MS = 10_000; // #24
const STALE_MS = 24 * 60 * 60 * 1000;

export function ago(ms: number, now = Date.now()): string {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

// Above the queue on Home (#56): what's waiting to be graded, when sync last ran, and Sync now.
export function SyncLine() {
  const [status, setStatus] = useState<SyncStatus>();
  const { setListOpen } = usePending();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [token, setToken] = useState<string>();

  const refresh = useCallback(async () => {
    const res = await api("/api/sync").catch(() => null);
    if (res?.ok) setStatus(await res.json());
  }, []);

  // Refresh every 10 s, only while the tab is visible.
  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onShow = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refresh]);

  const syncNow = async () => {
    setBusy(true);
    setNote(undefined);
    const [viaExtension, res] = await Promise.all([askExtensionToSync(), api("/api/sync", { method: "POST" }).catch(() => null)]);
    if (res?.status === 429) {
      const { retryAfterSeconds } = await res.json();
      setNote(`Synced a moment ago. Try again in ${retryAfterSeconds} s.`);
    } else if (!viaExtension) {
      setNote("Extension not reachable from this browser; checked LeetCode's public list instead.");
    }
    await refresh();
    setBusy(false);
  };

  const connect = async () => {
    const res = await api("/api/extension/pair", { method: "POST" });
    if (res.ok) setToken((await res.json()).token);
  };

  if (!status) return null;

  if (!status.connected || token) {
    return (
      <section aria-label="Sync" className="flex flex-col gap-3 rounded-[10px] border p-4">
        {token ? (
          <>
            <p className="font-medium">Your extension token. It's shown only once.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-full overflow-x-auto rounded-lg bg-subtle px-3 py-2 font-mono text-[13px]">{token}</code>
              <Button variant="outline" size="sm" className="h-11" onClick={() => void navigator.clipboard.writeText(token)}>
                Copy
              </Button>
            </div>
            <ol className="list-decimal pl-5 text-muted-foreground">
              <li>Install the extension: see extension/README.md (Load unpacked).</li>
              <li>Click its icon, pick this site ({window.location.host.startsWith("d22") ? "Dev" : "Prod"}), paste the token, Save.</li>
              <li>Stay logged in to LeetCode in that browser.</li>
            </ol>
            <Button variant="outline" className="self-start" onClick={() => setToken(undefined)}>
              Done
            </Button>
          </>
        ) : (
          <>
            <p>Sync your LeetCode submissions with the browser extension.</p>
            <Button className="self-start" onClick={() => void connect()}>
              Connect extension
            </Button>
          </>
        )}
      </section>
    );
  }

  const stale = status.extensionLastSeen !== null && Date.now() - status.extensionLastSeen > STALE_MS;
  return (
    <section aria-label="Sync" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {status.pending ? (
          <button
            type="button"
            className="min-h-11 cursor-pointer font-medium underline underline-offset-2"
            onClick={() => {
              window.scrollTo(0, 0);
              setListOpen(true);
            }}
          >
            {status.pending} new submission{status.pending === 1 ? "" : "s"} waiting to be graded
          </button>
        ) : (
          <span className="text-muted-foreground">No new submissions</span>
        )}
        <span className="text-[13px] text-muted-foreground">
          · {status.lastSyncAt ? `last synced ${ago(status.lastSyncAt)}` : "not synced yet"}
        </span>
        <Button variant="outline" size="sm" className="h-11 sm:ml-auto" disabled={busy} onClick={() => void syncNow()}>
          {busy ? "Syncing…" : "Sync now"}
        </Button>
      </div>
      {status.signedIn === false && (
        <p role="alert" className="text-[13px]">Log in to LeetCode in Chrome to keep syncing.</p>
      )}
      {stale && (
        <p role="alert" className="text-[13px]">
          The extension hasn't synced since {new Date(status.extensionLastSeen!).toLocaleString()}. Is Chrome open?
        </p>
      )}
      {status.lastError && <p role="alert" className="text-[13px]">Extension: {status.lastError}</p>}
      {note && <p role="status" className="text-[13px] text-muted-foreground">{note}</p>}
      <button
        type="button"
        onClick={() => void connect()}
        className="self-start py-2 text-[13px] text-muted-foreground underline-offset-2 hover:underline"
      >
        Reconnect extension
      </button>
    </section>
  );
}
