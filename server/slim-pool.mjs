/**
 * JSON.parse of a busy GPS day blocks the event loop. Do that work on
 * worker threads so Armada downloads keep running.
 */
import { Worker } from "node:worker_threads";
import { slimPointsJson } from "./slim-points.mjs";

const WORKERS = 2;
const SYNC_MAX = 4096;

/** @type {Array<{ worker: import("node:worker_threads").Worker, busy: boolean, resolve: ((s: string) => void) | null, reject: ((e: Error) => void) | null }> | null} */
let pool = null;
const queue = [];

function ensurePool() {
  if (pool) return;
  pool = [];
  for (let i = 0; i < WORKERS; i += 1) {
    const slot = { worker: null, busy: false, resolve: null, reject: null };
    const worker = new Worker(new URL("./slim-points-worker.mjs", import.meta.url));
    slot.worker = worker;
    worker.on("message", (msg) => {
      const resolve = slot.resolve;
      slot.resolve = null;
      slot.reject = null;
      slot.busy = false;
      resolve?.(msg?.ok ? String(msg.json ?? "[]") : "[]");
      pump();
    });
    worker.on("error", (err) => {
      const reject = slot.reject;
      slot.resolve = null;
      slot.reject = null;
      slot.busy = false;
      reject?.(err instanceof Error ? err : new Error("slim worker failed"));
      pump();
    });
    pool.push(slot);
  }
}

function pump() {
  if (!pool) return;
  while (queue.length) {
    const slot = pool.find((item) => !item.busy);
    if (!slot) return;
    const job = queue.shift();
    slot.busy = true;
    slot.resolve = job.resolve;
    slot.reject = job.reject;
    slot.worker.postMessage(job.text);
  }
}

function asText(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  return String(body);
}

export function slimAsync(body) {
  const size = Buffer.isBuffer(body) ? body.length : String(body || "").length;
  if (!body || size === 0 || size < SYNC_MAX) {
    return Promise.resolve(slimPointsJson(asText(body)));
  }
  ensurePool();
  return new Promise((resolve, reject) => {
    queue.push({
      text: body,
      resolve,
      reject: (err) => {
        try {
          resolve(slimPointsJson(asText(body)));
        } catch {
          reject(err);
        }
      },
    });
    pump();
  });
}
