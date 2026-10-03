/**
 * Offline Field APK session: snapshot, outbox, and fetch intercept.
 * Compiled only into the offline build (VITE_OFFLINE_FIELD=1). The live Field
 * site and the online APK do not call installOfflineField.
 */
import { registerPlugin } from "@capacitor/core";
import { fieldAppOrigin } from "./fieldAppUrl";
import { todayServiceDate } from "./serviceDay";
import {
  absorbServerBody,
  applyOfflineWrite,
  emptyOfflineSnap,
  isOfflineFieldGet,
  isOfflineFieldWrite,
  offlineApiPath,
  offlineCatalogScan,
  readOfflineGet,
  rememberOfflineGet,
  type OfflineSnap,
} from "./offlineFieldApply";

const DB_NAME = "armada-field-offline";
const DB_VERSION = 1;

type OutboxRow = {
  id: string;
  at: string;
  method: string;
  path: string;
  body: unknown;
};

type ConflictRow = {
  id: string;
  at: string;
  path: string;
  error: string;
};

export type OfflineFieldStatus = {
  syncedAt: string | null;
  pending: number;
  conflicts: ConflictRow[];
};

type TransportResult = { status: number; bodyText: string; session: string };

type OfflineHttpPlugin = {
  request(options: {
    url: string;
    method: string;
    body?: string;
    authorization?: string;
  }): Promise<{ status: number; body: string; session?: string }>;
};

const OfflineHttp = registerPlugin<OfflineHttpPlugin>("OfflineHttp");

const listeners = new Set<(status: OfflineFieldStatus) => void>();

let snap: OfflineSnap = emptyOfflineSnap();
let outbox: OutboxRow[] = [];
let conflicts: ConflictRow[] = [];
let sessionToken = "";
let ready: Promise<void> | null = null;
let flushing = false;
let installed = false;

function apiOrigin(): string {
  const fromEnv = String(import.meta.env.VITE_FIELD_API_ORIGIN || "").trim();
  return fieldAppOrigin(fromEnv || undefined);
}

export function offlineFieldEnabled(): boolean {
  return import.meta.env.VITE_OFFLINE_FIELD === "1";
}

/** Open Field before React reads the path. The packaged app starts at `/`, which is the admin console. */
export function bootOfflineFieldPath(): void {
  if (!offlineFieldEnabled()) return;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/index.html") {
    window.history.replaceState(null, "", `/m${window.location.search}`);
  }
}

export function offlineFieldStatus(): OfflineFieldStatus {
  return {
    syncedAt: snap.syncedAt,
    pending: outbox.length,
    conflicts: conflicts.slice(),
  };
}

export function subscribeOfflineField(listener: (status: OfflineFieldStatus) => void): () => void {
  listeners.add(listener);
  listener(offlineFieldStatus());
  return () => listeners.delete(listener);
}

function publish() {
  const status = offlineFieldStatus();
  for (const listener of listeners) listener(status);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const req = tx.objectStore("kv").get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function persist() {
  await idbSet("snap", snap);
  await idbSet("outbox", outbox);
  await idbSet("conflicts", conflicts);
  await idbSet("sessionToken", sessionToken);
  publish();
}

async function loadStore() {
  snap = (await idbGet<OfflineSnap>("snap")) || emptyOfflineSnap();
  outbox = (await idbGet<OutboxRow[]>("outbox")) || [];
  conflicts = (await idbGet<ConflictRow[]>("conflicts")) || [];
  sessionToken = (await idbGet<string>("sessionToken")) || "";
  publish();
}

function ensureStore(): Promise<void> {
  if (!ready) ready = loadStore().catch(() => publish());
  return ready;
}

function stampPhotoUrls(json: unknown): unknown {
  if (!sessionToken || json == null || typeof json !== "object") return json;
  const origin = apiOrigin();
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (
        key === "url" &&
        typeof child === "string" &&
        child.startsWith("/api/field/") &&
        child.includes("/photos/") &&
        !child.startsWith("data:")
      ) {
        const join = child.includes("?") ? "&" : "?";
        out[key] = `${origin}${child}${join}fieldSid=${encodeURIComponent(sessionToken)}`;
      } else {
        out[key] = walk(child);
      }
    }
    return out;
  };
  return walk(json);
}

async function nativeRequest(url: string, method: string, bodyText: string | undefined): Promise<TransportResult> {
  try {
    const result = await OfflineHttp.request({
      url,
      method,
      body: bodyText,
      authorization: sessionToken ? `Bearer ${sessionToken}` : "",
    });
    return {
      status: Number(result.status) || 0,
      bodyText: String(result.body || ""),
      session: String(result.session || ""),
    };
  } catch {
    return { status: 0, bodyText: "", session: "" };
  }
}

function jsonResponse(status: number, json: unknown): Response {
  return new Response(JSON.stringify(stampPhotoUrls(json)), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function readBody(init?: RequestInit): Promise<unknown> {
  const body = init?.body;
  if (body == null || typeof body !== "string") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function shouldQueueStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

async function direct(method: string, pathAndQuery: string, body: unknown): Promise<TransportResult> {
  const origin = apiOrigin();
  const url = `${origin}${pathAndQuery}`;
  const upper = method.toUpperCase();
  const bodyText = upper === "GET" || upper === "HEAD" || body === undefined ? undefined : JSON.stringify(body);
  return nativeRequest(url, upper, bodyText);
}

async function remember(pathAndQuery: string, json: unknown) {
  snap = rememberOfflineGet(snap, pathAndQuery, json, new Date().toISOString());
  await persist();
}

export async function prefetchOfflineField(): Promise<void> {
  if (!offlineFieldEnabled()) return;
  await ensureStore();
  const date = todayServiceDate();
  const paths = [
    `/api/field/dispatch/jobs?date=${encodeURIComponent(date)}`,
    "/api/field/dispatch/goods",
    "/api/field/maintenance/events",
    "/api/field/maintenance/catalog",
  ];
  for (const path of paths) {
    const result = await direct("GET", path, undefined);
    if (result.status >= 200 && result.status < 300) {
      snap = rememberOfflineGet(snap, path, parseJson(result.bodyText), new Date().toISOString());
    }
  }
  await persist();
}

export async function flushOfflineField(): Promise<void> {
  if (!offlineFieldEnabled() || flushing) return;
  await ensureStore();
  if (!outbox.length) return;
  flushing = true;
  try {
    while (outbox.length) {
      const row = outbox[0]!;
      const result = await direct(row.method, row.path, row.body);
      if (shouldQueueStatus(result.status)) break;
      const json = parseJson(result.bodyText) as { error?: string };
      if (result.status >= 200 && result.status < 300) {
        snap = absorbServerBody(snap, json);
        outbox = outbox.slice(1);
        await persist();
        continue;
      }
      conflicts = [
        ...conflicts,
        { id: row.id, at: row.at, path: row.path, error: json.error || `HTTP ${result.status}` },
      ].slice(-20);
      outbox = outbox.slice(1);
      await persist();
    }
    if (!outbox.length) await prefetchOfflineField();
  } finally {
    flushing = false;
    publish();
  }
}

async function queueWrite(method: string, pathAndQuery: string, body: unknown): Promise<Response> {
  const at = new Date().toISOString();
  const applied = applyOfflineWrite(snap, method, pathAndQuery, body, at);
  if ("error" in applied) return jsonResponse(400, { error: applied.error });
  snap = applied.snap;
  outbox = [
    ...outbox,
    {
      id: crypto.randomUUID(),
      at,
      method: method.toUpperCase(),
      path: pathAndQuery,
      body: body ?? {},
    },
  ];
  await persist();
  return jsonResponse(applied.result.status, applied.result.json);
}

export async function installOfflineField(nativeFetch: typeof fetch): Promise<void> {
  if (!offlineFieldEnabled() || installed) return;
  installed = true;
  bootOfflineFieldPath();
  // Patch fetch before the first await. Otherwise the login check hits the
  // packaged page, fails, and the next launch shows the sign-in screen.
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = requestUrl(input);
    const { path, search } = offlineApiPath(rawUrl);
    if (!path.startsWith("/api/")) return nativeFetch(input, init);
    await ensureStore();
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const pathAndQuery = `${path}${search}`;
    const body = await readBody(init);

    if (method === "POST" && path === "/api/field/login") {
      const result = await direct("POST", path, body);
      const json = parseJson(result.bodyText) as { sessionToken?: string };
      const token = json.sessionToken || result.session;
      if (result.status >= 200 && result.status < 300 && token) {
        sessionToken = token;
        await persist();
        void prefetchOfflineField();
      }
      return jsonResponse(result.status || 503, json);
    }

    if (method === "POST" && path === "/api/field/logout") {
      const result = await direct("POST", path, body);
      sessionToken = "";
      await persist();
      return jsonResponse(result.status || 200, parseJson(result.bodyText));
    }

    if (method === "POST" && path === "/api/field/scan") {
      const payload = body && typeof body === "object" ? (body as { code?: string; context?: string }) : {};
      const result = await direct("POST", path, body);
      if (!shouldQueueStatus(result.status)) return jsonResponse(result.status, parseJson(result.bodyText));
      return jsonResponse(200, offlineCatalogScan(snap, String(payload.code || ""), String(payload.context || "any")).json);
    }

    if (isOfflineFieldGet(method, path)) {
      const result = await direct("GET", pathAndQuery, undefined);
      if (result.status >= 200 && result.status < 300) {
        const json = parseJson(result.bodyText);
        await remember(pathAndQuery, json);
        return jsonResponse(result.status, json);
      }
      if (shouldQueueStatus(result.status)) {
        const cached = readOfflineGet(snap, pathAndQuery);
        if (cached) return jsonResponse(cached.status, cached.json);
        return jsonResponse(503, {
          error: "No connection. Open this app once while online to save today's jobs.",
        });
      }
      return jsonResponse(result.status || 503, parseJson(result.bodyText) || { error: "Offline" });
    }

    if (isOfflineFieldWrite(method, path)) {
      const result = await direct(method, pathAndQuery, body);
      if (result.status >= 200 && result.status < 300) {
        const json = parseJson(result.bodyText);
        snap = absorbServerBody(snap, json);
        await persist();
        return jsonResponse(result.status, json);
      }
      if (shouldQueueStatus(result.status)) return queueWrite(method, pathAndQuery, body);
      return jsonResponse(result.status, parseJson(result.bodyText));
    }

    const result = await direct(method, pathAndQuery, body);
    if (result.status >= 200 && result.status < 300 && path === "/api/field/me") {
      void prefetchOfflineField();
    }
    if (result.status === 0) {
      return jsonResponse(503, { error: "No connection. This action was not saved." });
    }
    return jsonResponse(result.status, parseJson(result.bodyText));
  };

  window.addEventListener("online", () => {
    void flushOfflineField();
  });
  window.setInterval(() => {
    void flushOfflineField();
  }, 30_000);
  void flushOfflineField();
}
