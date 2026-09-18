/**
 * On-duty driver location tracking for the mobile Dispatch PWA.
 *
 * What the web platform actually allows, so nobody expects more:
 * - `watchPosition` only runs while this page is alive. Once the OS suspends the
 *   tab (screen off on iOS, aggressive backgrounding on Android), fixes stop.
 * - A service worker cannot take a fix — `geolocation` does not exist in
 *   `ServiceWorkerGlobalScope` — so it can only re-send what we already queued.
 * - Screen Wake Lock keeps the display on while the app is foregrounded, which is
 *   the closest thing to continuous tracking a PWA has.
 *
 * The design therefore assumes gaps are normal: every fix is queued in IndexedDB
 * with its own timestamp and flushed opportunistically, and Dispatch Live judges
 * freshness from `recordedAt` rather than trusting that the newest row is now.
 */

const DB_NAME = "dispatch-driver-location";
const DB_VERSION = 1;
const STORE = "pings";
const SYNC_TAG = "dispatch-ping-flush";

/** Emit a fix once the driver has moved this far, regardless of the timer. */
const MIN_MOVE_M = 25;
/** Emit at least this often even when parked, so Live can tell idle from dead. */
const MAX_QUIET_MS = 60_000;
/** Fastest we will record while moving. */
const MIN_INTERVAL_MS = 15_000;
const FLUSH_INTERVAL_MS = 30_000;
const MAX_BATCH = 50;
/** Above this the fix says little about which street the driver is on. */
const MAX_ACCURACY_M = 2000;
/** No point holding an unsendable backlog forever. */
const MAX_QUEUE_ROWS = 2000;

export type DriverLocationStatus = {
  /** Tracking loop is running. */
  active: boolean;
  /** Geolocation permission as last observed. */
  permission: "unknown" | "granted" | "denied" | "prompt";
  /** ISO time of the most recent accepted fix. */
  lastFixAt: string | null;
  /** ISO time of the most recent successful upload. */
  lastSentAt: string | null;
  /** Fixes waiting in IndexedDB. */
  queued: number;
  /** Screen wake lock is held. */
  wakeLock: boolean;
  /** Last error worth showing the driver. */
  error: string | null;
};

type QueueRow = { id?: number; ping: DriverPingPayload };

export type DriverPingPayload = {
  lat: number;
  lon: number;
  accuracyM: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  recordedAt: string;
  jobId: string | null;
};

let db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function runTx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => T | Promise<T>) {
  return openDb().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result: T | Promise<T>;
        try {
          result = fn(store);
        } catch (err) {
          reject(err);
          return;
        }
        tx.oncomplete = () => resolve(result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

function toPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Metres between two coordinates. Equirectangular is plenty at these scales. */
export function metresBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const mLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const x = dLon * Math.cos(mLat);
  return Math.sqrt(dLat * dLat + x * x) * R;
}

/**
 * Should this fix be recorded, given the last one we kept?
 * Exported for tests: this filter is what keeps the ping volume sane.
 */
export function shouldRecordFix(
  next: { lat: number; lon: number; accuracyM: number | null; at: number },
  last: { lat: number; lon: number; at: number } | null,
): boolean {
  if (next.accuracyM != null && next.accuracyM > MAX_ACCURACY_M) return false;
  if (!last) return true;
  const elapsed = next.at - last.at;
  if (elapsed >= MAX_QUIET_MS) return true;
  if (elapsed < MIN_INTERVAL_MS) return false;
  return metresBetween(last.lat, last.lon, next.lat, next.lon) >= MIN_MOVE_M;
}

const status: DriverLocationStatus = {
  active: false,
  permission: "unknown",
  lastFixAt: null,
  lastSentAt: null,
  queued: 0,
  wakeLock: false,
  error: null,
};

const listeners = new Set<(s: DriverLocationStatus) => void>();

function emit() {
  const snapshot = { ...status };
  for (const fn of listeners) fn(snapshot);
}

export function subscribeDriverLocation(fn: (s: DriverLocationStatus) => void): () => void {
  listeners.add(fn);
  fn({ ...status });
  return () => listeners.delete(fn);
}

export function driverLocationStatus(): DriverLocationStatus {
  return { ...status };
}

let watchId: number | null = null;
let flushTimer: number | null = null;
let wakeLock: WakeLockSentinel | null = null;
let lastKept: { lat: number; lon: number; at: number } | null = null;
let activeJobId: string | null = null;
let flushing = false;

async function refreshQueueCount() {
  try {
    status.queued = await runTx("readonly", (store) => toPromise(store.count()));
  } catch {
    // A blocked IndexedDB (private mode, quota) must not break tracking.
  }
}

async function enqueue(ping: DriverPingPayload) {
  await runTx("readwrite", (store) => {
    store.add({ ping } as QueueRow);
  });
  await refreshQueueCount();
  if (status.queued > MAX_QUEUE_ROWS) await trimQueue();
  emit();
}

/** Drop the oldest rows when the backlog outgrows what Live could ever use. */
async function trimQueue() {
  const rows = await runTx("readonly", (store) => toPromise(store.getAll() as IDBRequest<QueueRow[]>));
  const excess = rows.slice(0, Math.max(0, rows.length - MAX_QUEUE_ROWS));
  if (!excess.length) return;
  await runTx("readwrite", (store) => {
    for (const row of excess) if (row.id != null) store.delete(row.id);
  });
  await refreshQueueCount();
}

/** Send queued fixes. Rows are only deleted once the server has taken them. */
export async function flushDriverLocationQueue(): Promise<boolean> {
  if (flushing) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  flushing = true;
  try {
    for (;;) {
      const rows = await runTx("readonly", (store) =>
        toPromise(store.getAll() as IDBRequest<QueueRow[]>),
      );
      if (!rows.length) return true;
      const batch = rows.slice(0, MAX_BATCH);
      let res: Response;
      try {
        res = await fetch("/api/field/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ pings: batch.map((r) => r.ping) }),
        });
      } catch {
        await requestBackgroundSync();
        return false;
      }
      if (res.status === 429 || res.status >= 500) {
        await requestBackgroundSync();
        return false;
      }
      if (res.status === 401 || res.status === 403) {
        status.error = "Session expired — sign in again to keep sharing location";
        emit();
        return false;
      }
      // The server has either stored or permanently refused these rows.
      await runTx("readwrite", (store) => {
        for (const row of batch) if (row.id != null) store.delete(row.id);
      });
      if (res.ok) {
        status.lastSentAt = new Date().toISOString();
        status.error = null;
      }
      await refreshQueueCount();
      emit();
      if (rows.length <= MAX_BATCH) return true;
    }
  } finally {
    flushing = false;
  }
}

async function requestBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    // Background Sync is Chromium-only; on iOS this simply does not exist and the
    // queue waits for the next foreground flush.
    const sync = (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })
      ?.sync;
    await sync?.register(SYNC_TAG);
  } catch {
    // Nothing to do — the periodic foreground flush is the fallback.
  }
}

/** Register the flush-only service worker. Safe to call repeatedly. */
export async function registerDriverServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // No SW means no Background Sync; foreground flushing still works.
  }
}

async function acquireWakeLock() {
  const nav = navigator as Navigator & {
    wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> };
  };
  if (!nav.wakeLock) return;
  if (wakeLock && !wakeLock.released) return;
  if (document.visibilityState !== "visible") return;
  try {
    wakeLock = await nav.wakeLock.request("screen");
    status.wakeLock = true;
    wakeLock.addEventListener("release", () => {
      status.wakeLock = false;
      emit();
    });
    emit();
  } catch {
    status.wakeLock = false;
  }
}

async function releaseWakeLock() {
  try {
    await wakeLock?.release();
  } catch {
    // Already released by the platform.
  }
  wakeLock = null;
  status.wakeLock = false;
}

function onVisibility() {
  if (!status.active) return;
  if (document.visibilityState === "visible") {
    void acquireWakeLock();
    void flushDriverLocationQueue();
  }
}

function onOnline() {
  if (status.active) void flushDriverLocationQueue();
}

async function readPermission() {
  try {
    const perm = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (perm) status.permission = perm.state as DriverLocationStatus["permission"];
  } catch {
    // Permissions API is unavailable on older Safari; the watch callback tells us.
  }
}

function handleFix(pos: GeolocationPosition) {
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const at = Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now();
  const accuracyM = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
  if (!shouldRecordFix({ lat, lon, accuracyM, at }, lastKept)) return;
  lastKept = { lat, lon, at };
  status.permission = "granted";
  status.lastFixAt = new Date(at).toISOString();
  status.error = null;
  void enqueue({
    lat,
    lon,
    accuracyM,
    speedMps: Number.isFinite(pos.coords.speed as number) ? pos.coords.speed : null,
    headingDeg: Number.isFinite(pos.coords.heading as number) ? pos.coords.heading : null,
    recordedAt: new Date(at).toISOString(),
    jobId: activeJobId,
  });
  emit();
}

function handleWatchError(err: GeolocationPositionError) {
  if (err.code === err.PERMISSION_DENIED) {
    status.permission = "denied";
    status.error = "Location permission is off — Dispatch cannot see your position";
    void stopDutyTracking();
    return;
  }
  if (err.code === err.POSITION_UNAVAILABLE) {
    status.error = "No GPS signal right now";
  } else if (err.code === err.TIMEOUT) {
    status.error = "GPS is slow to respond";
  }
  emit();
}

/**
 * Begin sharing position while on duty. Idempotent; call again with a new job id
 * to re-tag subsequent fixes.
 */
export async function startDutyTracking(jobId?: string | null): Promise<boolean> {
  activeJobId = jobId || null;
  if (status.active) {
    emit();
    return true;
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    status.error = "This device cannot share location";
    emit();
    return false;
  }
  status.active = true;
  status.error = null;
  lastKept = null;
  emit();

  void registerDriverServiceWorker();
  void readPermission();
  await refreshQueueCount();

  watchId = navigator.geolocation.watchPosition(handleFix, handleWatchError, {
    enableHighAccuracy: true,
    timeout: 30_000,
    // Never reuse a cached fix: a stale one would look like fresh movement.
    maximumAge: 0,
  });

  flushTimer = window.setInterval(() => void flushDriverLocationQueue(), FLUSH_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  void acquireWakeLock();
  emit();
  return true;
}

/** Stop sharing position. Queued fixes are flushed one last time. */
export async function stopDutyTracking(): Promise<void> {
  if (watchId != null) {
    navigator.geolocation?.clearWatch(watchId);
    watchId = null;
  }
  if (flushTimer != null) {
    window.clearInterval(flushTimer);
    flushTimer = null;
  }
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("online", onOnline);
  await releaseWakeLock();
  status.active = false;
  activeJobId = null;
  lastKept = null;
  emit();
  // Best effort: a driver going off duty should not leave fixes stranded.
  await flushDriverLocationQueue().catch(() => false);
}

const CONSENT_KEY = "dispatch.duty.locationConsent";

/**
 * Location sharing is opt-in and remembered per device. Tracking never starts
 * without this, so a driver can withhold it and still work the job.
 */
export function readLocationConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeLocationConsent(on: boolean): void {
  try {
    if (on) localStorage.setItem(CONSENT_KEY, "1");
    else localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Storage blocked; consent then lasts for this session only.
  }
}

/** Human "12s ago" / "4m ago" for the on-duty indicator. */
export function formatAge(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ago`;
}
