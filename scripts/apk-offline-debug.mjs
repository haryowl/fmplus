/**
 * Debug APK for android-offline. Run `npm run apk:offline:sync` first.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const android = path.join(root, "android-offline");
const isWin = process.platform === "win32";

if (!isWin) {
  try {
    fs.chmodSync(path.join(android, "gradlew"), 0o755);
  } catch {
    /* sh ./gradlew still works */
  }
}

const child = isWin
  ? spawn("gradlew.bat", ["assembleDebug"], { cwd: android, stdio: "inherit", shell: true })
  : spawn("sh", ["./gradlew", "assembleDebug"], { cwd: android, stdio: "inherit" });

child.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});

child.on("exit", (code) => {
  const apk = path.join(android, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  if ((code ?? 1) === 0 && fs.existsSync(apk)) console.log(`Offline APK: ${apk}`);
  process.exit(code ?? 1);
});
