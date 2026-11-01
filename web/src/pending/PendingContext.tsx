import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Submission } from "../../../api/src/sync/types";
import { api } from "../api";
import { groupPending, type PendingGroup } from "./group";

const POLL_MS = 10_000; // #24

interface Pending {
  groups: PendingGroup[];
  refresh: () => Promise<void>;
  listOpen: boolean;
  setListOpen: (open: boolean) => void;
}

const PendingContext = createContext<Pending>({ groups: [], refresh: async () => {}, listOpen: false, setListOpen: () => {} });
export const usePending = () => useContext(PendingContext);

// What's waiting to be graded, shared by the bell, notifications, Home and the problem page.
export function PendingProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [subs, setSubs] = useState<Submission[]>([]);
  const [listOpen, setListOpen] = useState(false);

  const refresh = useCallback(async () => {
    const res = await api("/api/pending").catch(() => null);
    if (res?.ok) setSubs(((await res.json()) as { submissions: Submission[] }).submissions);
  }, []);

  // Every 10 s, only while the tab is visible and you're logged in.
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, refresh]);

  const value = useMemo(() => ({ groups: groupPending(subs), refresh, listOpen, setListOpen }), [subs, refresh, listOpen]);
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}
