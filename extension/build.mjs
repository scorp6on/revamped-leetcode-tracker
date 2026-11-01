/* global console */
// Bundles the extension into dist/, the folder you load with "Load unpacked" in Chrome or Edge.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
await build({
  entryPoints: ["src/background.ts", "src/options.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome120",
});
for (const f of ["manifest.json", "options.html"]) copyFileSync(f, `dist/${f}`);
console.log("built extension/dist");
