/**
 * Build the offline Field UI into android-offline assets.
 * Does not touch dist/ or the online android/ project.
 *
 *   npm run apk:offline:sync
 *   npm run apk:offline:debug
 *
 * FIELD_APP_URL overrides the API host (default https://81.17.100.7:4173).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist-offline");
const assets = path.join(root, "android-offline", "app", "src", "main", "assets", "public");
const origin = String(process.env.FIELD_APP_URL || "https://81.17.100.7:4173").replace(/\/+$/, "").replace(/\/m$/i, "");

function run(command, args) {
  const child = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      VITE_OFFLINE_FIELD: "1",
      VITE_FIELD_API_ORIGIN: origin,
    },
  });
  if (child.status !== 0) process.exit(child.status ?? 1);
}

run("npx", ["tsc", "-b"]);
run("npx", ["vite", "build", "--outDir", "dist-offline"]);

fs.rmSync(assets, { recursive: true, force: true });
fs.cpSync(outDir, assets, { recursive: true });
console.log(`Offline Field assets: ${assets}`);
console.log(`API origin: ${origin}`);
