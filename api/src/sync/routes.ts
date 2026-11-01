import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { json } from "../http";
import type { SyncStore } from "./store";
import { hashToken } from "./token";
import { SYNC_COOLDOWN_MS, type SyncStatus } from "./types";

export interface SyncRouteDeps {
  store: SyncStore;
  runBackup: () => Promise<void>; // starts the backup poll without waiting for it
  newToken: () => string;
  now: () => number;
}

// The app's side of sync (#56): pairing, status for the Home line, and Sync now.
export const makeSyncRoutes = ({ store, runBackup, newToken, now }: SyncRouteDeps) => ({
  // A new token disconnects the old one. Shown once; only its hash is kept.
  pair: async (): Promise<APIGatewayProxyResultV2> => {
    const state = await store.state();
    const token = newToken();
    await store.updateState({
      tokenHash: hashToken(token),
      // Re-pairing keeps the original start, so nothing synced since then is dropped.
      connectedAt: state.connectedAt ?? now(),
    });
    return json(201, { token });
  },

  status: async (): Promise<APIGatewayProxyResultV2> => {
    const [state, pending] = await Promise.all([store.state(), store.pendingCount()]);
    const times = [state.lastExtensionSync, state.lastPublicSync].filter((t): t is number => typeof t === "number");
    const status: SyncStatus = {
      connected: !!state.tokenHash,
      pending,
      lastSyncAt: times.length ? Math.max(...times) : null,
      extensionLastSeen: state.lastExtensionSync ?? null,
      signedIn: state.signedIn ?? null,
      lastError: state.lastError ?? null,
    };
    return json(200, status);
  },

  // Sync now (#10's cooldown). The page also asks the extension directly; this runs the backup poll.
  syncNow: async (): Promise<APIGatewayProxyResultV2> => {
    const state = await store.state();
    const wait = (state.lastManualSync ?? 0) + SYNC_COOLDOWN_MS - now();
    if (wait > 0) return json(429, { error: "synced a moment ago", retryAfterSeconds: Math.ceil(wait / 1000) });
    await store.updateState({ lastManualSync: now() });
    await runBackup();
    return json(202, { started: true });
  },
});
