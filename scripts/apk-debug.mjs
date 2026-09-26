/**
 * Assemble the sideload debug APK. Run `npm run apk:sync` first so Capacitor
 * copies the latest web build and capacitor.config.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const android = path.join(root, "android");
const isWin = process.platform === "win32";
const gradlew = isWin ? "gradlew.bat" : "./gradlew";

const child = spawn(gradlew, ["assembleDebug"], {
  cwd: android,
  stdio: "inherit",
  shell: isWin,
});

child.on("exit", (code) => {
  const apk = path.join(android, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  if ((code ?? 1) === 0 && fs.existsSync(apk)) {
    console.log(`APK: ${apk}`);
  }
  process.exit(code ?? 1);
});
