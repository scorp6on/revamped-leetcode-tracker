// The extension's fixed ID, from the `key` in extension/manifest.json (#56).
export const EXTENSION_ID = "aiamgbbmklpoedchoheiejleeopcnfca";

interface ChromeRuntime {
  sendMessage(id: string, msg: unknown, reply: (r: unknown) => void): void;
  lastError?: unknown;
}

// Asks the extension in this browser to sync now. Resolves false when it isn't installed (e.g. on
// a phone), or doesn't answer in time; the backup poll still runs either way.
export function askExtensionToSync(timeoutMs = 20_000): Promise<boolean> {
  const runtime = (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    try {
      runtime.sendMessage(EXTENSION_ID, { type: "sync" }, (reply) => {
        clearTimeout(timer);
        // Reading lastError tells Chrome we handled "no such extension".
        resolve(!runtime.lastError && (reply as { ok?: boolean } | undefined)?.ok === true);
      });
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}
