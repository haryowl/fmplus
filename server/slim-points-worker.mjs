import { parentPort } from "node:worker_threads";
import { slimPointsJson } from "./slim-points.mjs";

parentPort.on("message", (body) => {
  try {
    const text = typeof body === "string" ? body : Buffer.from(body).toString("utf8");
    parentPort.postMessage({ ok: true, json: slimPointsJson(text) });
  } catch {
    parentPort.postMessage({ ok: false, json: "[]" });
  }
});
