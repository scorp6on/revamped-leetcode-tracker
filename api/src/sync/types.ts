// Shapes shared by the sync Lambdas, the web app and the extension (#55, #56). Type-only, no imports.

// One LeetCode submission, as stored at SUB#<id> until you grade it (M7).
export interface Submission {
  id: string; // LeetCode's submission ID: the dedupe key (#10)
  slug: string; // problem slug; linked to the problem number at grading time (#56)
  title: string;
  status: string; // e.g. "Accepted", "Wrong Answer"
  accepted: boolean;
  lang: string; // "" when unknown (backup poll)
  runtime: string | null;
  memory: string | null;
  timestamp: number; // unix seconds, when you submitted
  code: string | null; // null when unknown (backup poll)
  source: "extension" | "public";
}

// The SYNC item: pairing and the latest news from the extension and the backup poll.
export interface SyncState {
  tokenHash?: string; // SHA-256 of the extension token; the token itself is never stored
  connectedAt?: number; // ms; nothing older is imported (#56)
  username?: string | null; // reported by the extension; the backup poll needs it
  signedIn?: boolean | null; // is Chrome logged in to LeetCode?
  lastExtensionSync?: number; // ms
  lastPublicSync?: number; // ms
  lastError?: string | null; // from the extension
  lastManualSync?: number; // ms, for Sync now's cooldown
}

export interface SyncStatus {
  connected: boolean;
  pending: number; // submissions waiting to be graded
  lastSyncAt: number | null; // ms, from either source
  extensionLastSeen: number | null; // ms
  signedIn: boolean | null;
  lastError: string | null;
}

export const MAX_SUBMISSIONS_PER_POST = 100;
export const MAX_CODE_LENGTH = 64 * 1024;
export const SYNC_COOLDOWN_MS = 60_000;
