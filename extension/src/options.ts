// The options page: which tracker to send to, the pairing token, Sync now and the last result.
import type { Config, SyncResult } from "./background";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const server = $<HTMLSelectElement>("server");
const token = $<HTMLInputElement>("token");

async function show() {
  const cfg = (await chrome.storage.local.get(null)) as Config;
  if (cfg.server) server.value = cfg.server;
  token.placeholder = cfg.token ? "Saved. Paste a new token to replace it" : "Paste the token from the tracker";
  $("last").textContent = cfg.lastSync
    ? `Last synced ${new Date(cfg.lastSync).toLocaleString()}${cfg.lastVia ? ` (via ${cfg.lastVia})` : ""}.`
    : "Not synced yet.";
  $("error").textContent = cfg.lastError ?? "";
}

$("save").addEventListener("click", async () => {
  const patch: Config = { server: server.value };
  // A new token or a different tracker starts fresh, so nothing is skipped or sent twice.
  if (token.value.trim()) Object.assign(patch, { token: token.value.trim(), lastSeenId: null });
  const before = (await chrome.storage.local.get("server")) as Config;
  if (before.server && before.server !== server.value) patch.lastSeenId = null;
  await chrome.storage.local.set(patch);
  token.value = "";
  await show();
});

$("sync").addEventListener("click", async () => {
  $("last").textContent = "Syncing…";
  const result = (await chrome.runtime.sendMessage({ type: "sync" })) as SyncResult;
  await show();
  if (result.ok) $("last").textContent += ` Sent ${result.sent} new submission${result.sent === 1 ? "" : "s"}.`;
});

chrome.storage.onChanged.addListener(() => void show());
void show();
