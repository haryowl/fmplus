/**
 * Prepare the Dispatch APK (Jobs + Dispatch Live). Does not touch android/ or
 * capacitor.config.ts (Field online APK stays unchanged).
 *
 *   npm run apk:dispatch:sync
 *   npm run apk:dispatch:debug
 *
 * FIELD_APP_URL overrides the desk host (default https://81.17.100.7:4173).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist");
const assetsPublic = path.join(root, "android-dispatch", "app", "src", "main", "assets", "public");
const configPath = path.join(root, "android-dispatch", "app", "src", "main", "assets", "capacitor.config.json");
const origin = String(process.env.FIELD_APP_URL || "https://81.17.100.7:4173")
  .replace(/\/+$/, "")
  .replace(/\/m$/i, "")
  .replace(/\/jobs$/i, "");

function run(command, args) {
  const child = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (child.status !== 0) process.exit(child.status ?? 1);
}

run("npx", ["tsc", "-b"]);
run("npx", ["vite", "build"]);

fs.rmSync(assetsPublic, { recursive: true, force: true });
fs.cpSync(outDir, assetsPublic, { recursive: true });

const config = {
  appId: "id.armada.dispatch",
  appName: "ARMADA Dispatch",
  webDir: "dist",
  server: {
    url: `${origin}/jobs`,
    androidScheme: origin.startsWith("http:") ? "http" : "https",
    cleartext: origin.startsWith("http:") || origin.includes("81.17.100.7"),
    allowNavigation: [origin, `${origin}/*`],
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true,
  },
};
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Dispatch assets: ${assetsPublic}`);
console.log(`Desk origin: ${origin}`);
console.log(`WebView URL: ${config.server.url}`);
