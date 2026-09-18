/**
 * Dispatch driver service worker — queue flushing only.
 *
 * Deliberately does NOT cache HTML or assets. index.html is served no-store and
 * the JS bundle is content-hashed, so a caching SW would only add the risk of
 * pinning drivers to a stale deploy. The single job here is to drain the
 * location queue after connectivity returns, via Background Sync.
 *
 * Note: geolocation is not available in ServiceWorkerGlobalScope, so this cannot
 * take a fix on its own. It can only send what the page already captured.
 */

const PING_DB = "dispatch-driver-location";
const PING_DB_VERSION = 1;
const PING_STORE = "pings";
const SYNC_TAG = "dispatch-ping-flush";
const MAX_BATCH = 50;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PING_DB, PING_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PING_STORE)) {
        db.createObjectStore(PING_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(PING_STORE, mode);
    const store = t.objectStore(PING_STORE);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function flushQueue() {
  const db = await openDb();
  try {
    for (;;) {
      const rows = await tx(db, "readonly", (store) => reqToPromise(store.getAll()));
      if (!rows.length) return true;
      const batch = rows.slice(0, MAX_BATCH);
      const res = await fetch("/api/field/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ pings: batch.map((r) => r.ping) }),
      });
      // 4xx other than 429 means the server will never accept these rows;
      // dropping them is better than retrying forever. 429/5xx keep the queue.
      if (res.status === 429 || res.status >= 500) return false;
      const drop = batch.map((r) => r.id);
      await tx(db, "readwrite", (store) => {
        for (const id of drop) store.delete(id);
      });
      if (!res.ok) return false;
      if (rows.length <= MAX_BATCH) return true;
    }
  } finally {
    db.close();
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  // Rejecting keeps the sync registration alive for the next retry.
  event.waitUntil(
    flushQueue().then((done) => {
      if (!done) throw new Error("ping flush incomplete");
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "dispatch-ping-flush") {
    event.waitUntil(flushQueue().catch(() => {}));
  }
});
