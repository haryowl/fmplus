import { API_RETRY_ATTEMPTS, API_RETRY_CAP_MS, TRACK_BATCH_BROWSER, TRACK_BATCH_SIZE, TRACK_FETCH_CONCURRENCY } from "./config";
import { chunkArray, mapPool } from "./pool";
import { apiBase, tenantHeaders } from "./tenant";
import type { Group, LoadProgress, TrackInfo, TrackPoint, Trip, User } from "./types";
import { formatUpdatedSince, updatedSinceWindows } from "./time";

type ListResponse<T> = T[] | { items?: T[] };

function unwrap<T>(raw: ListResponse<T>): T[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.items)) return raw.items;
  return [];
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(resolve, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function retryDelayMs(res: Response | null, attempt: number): number {
  if (res) {
    const header = res.headers.get("Retry-After");
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 20_000);
      }
    }
  }
  return Math.min(400 * 2 ** attempt, API_RETRY_CAP_MS);
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let lastStatus = 0;
  let lastError = "request failed";

  for (let attempt = 0; attempt < API_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${apiBase()}${path}`, {
        headers: { accept: "application/json", ...tenantHeaders() },
        signal,
      });
      lastStatus = res.status;

      if (isRetryableStatus(res.status)) {
        lastError = `Armada ${res.status}`;
        await wait(retryDelayMs(res, attempt), signal);
        continue;
      }

      if (!res.ok) {
        throw new Error(`Armada ${res.status} on ${path}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      if (err instanceof Error && err.message.startsWith("Armada ") && !err.message.includes(" after retries")) {
        throw err;
      }
      lastError = err instanceof Error ? err.message : "network error";
      if (attempt < API_RETRY_ATTEMPTS - 1) {
        await wait(retryDelayMs(null, attempt), signal);
        continue;
      }
      throw new Error(`${lastError} on ${path}`);
    }
  }

  throw new Error(`Armada ${lastStatus || lastError} on ${path} after retries`);
}

export async function fetchGroups(signal?: AbortSignal): Promise<Group[]> {
  const raw = await apiGet<ListResponse<Record<string, unknown>>>(
    "/groups?FromIndex=0&PageSize=1000",
    signal,
  );
  return unwrap(raw)
    .map((g) => ({
      id: Number(g.id ?? g.groupId),
      name: String(g.name ?? `Group ${g.id}`),
      usersIds: Array.isArray(g.usersIds) ? g.usersIds.map(Number) : [],
    }))
    .filter((g) => Number.isFinite(g.id));
}

export async function fetchUsersForGroup(group: Group, signal?: AbortSignal): Promise<User[]> {
  if (group.usersIds.length > 0) {
    const raw = await apiGet<ListResponse<Record<string, unknown>>>(
      "/users?FromIndex=0&PageSize=1000",
      signal,
    );
    const all = unwrap(raw).map((u) => ({
      id: Number(u.id),
      name: typeof u.name === "string" ? u.name : undefined,
      username: typeof u.username === "string" ? u.username : undefined,
    }));
    const wanted = new Set(group.usersIds);
    const matched = all.filter((u) => wanted.has(u.id));
    if (matched.length > 0) return matched;
    return group.usersIds.map((id) => ({ id, name: `User ${id}` }));
  }

  const raw = await apiGet<ListResponse<Record<string, unknown>>>(
    `/groups/${group.id}/users?FromIndex=0&PageSize=1000`,
    signal,
  );
  return unwrap(raw).map((u) => ({
    id: Number(u.id ?? u.userId),
    name: typeof u.name === "string" ? u.name : undefined,
    username: typeof u.username === "string" ? u.username : undefined,
  }));
}

function asTrackInfo(item: Record<string, unknown>): TrackInfo | null {
  const id = Number(item.id);
  const userId = Number(item.userId);
  if (!Number.isFinite(id) || !Number.isFinite(userId)) return null;
  return {
    id,
    userId,
    created: typeof item.created === "string" ? item.created : undefined,
  };
}

/** One V17-style call: huge page, no FromIndex walk. */
async function fetchTrackInfoWindow(
  updatedSince: string,
  signal?: AbortSignal,
): Promise<TrackInfo[]> {
  const raw = await apiGet<ListResponse<Record<string, unknown>>>(
    `/trackinfos?UpdatedSince=${encodeURIComponent(updatedSince)}&FromIndex=0&PageSize=10000000`,
    signal,
  );
  const out: TrackInfo[] = [];
  for (const item of unwrap(raw)) {
    const info = asTrackInfo(item);
    if (info) out.push(info);
  }
  return out;
}

async function fetchTracks(trackInfoId: number, signal?: AbortSignal): Promise<TrackPoint[]> {
  const raw = await apiGet<ListResponse<TrackPoint>>(
    `/trackinfos/${trackInfoId}/tracks?Filtered=true`,
    signal,
  );
  return unwrap(raw);
}

type BatchTracksResponse = {
  byId?: Record<string, TrackPoint[]>;
  failed?: number[];
};

let batchEndpoint: "unknown" | "yes" | "no" = "unknown";

const trackPointCache = new Map<number, TrackPoint[]>();
const TRACK_CACHE_MAX = 800;

function rememberTracks(id: number, points: TrackPoint[]) {
  if (trackPointCache.has(id)) {
    trackPointCache.delete(id);
  } else if (trackPointCache.size >= TRACK_CACHE_MAX) {
    const oldest = trackPointCache.keys().next().value;
    if (oldest !== undefined) trackPointCache.delete(oldest);
  }
  trackPointCache.set(id, points);
}

async function fetchTracksBatch(
  ids: number[],
  signal?: AbortSignal,
): Promise<{ byId: Map<number, TrackPoint[]>; failed: number[] }> {
  const res = await fetch("/api/tracks-batch", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify({ ids }),
    signal,
  });
  if (res.status === 404 || res.status === 405) {
    throw Object.assign(new Error("batch unavailable"), { batchUnavailable: true as const });
  }
  if (!res.ok) {
    throw new Error(`Track batch ${res.status}`);
  }
  const raw = (await res.json()) as BatchTracksResponse;
  const byId = new Map<number, TrackPoint[]>();
  for (const [key, points] of Object.entries(raw.byId ?? {})) {
    const id = Number(key);
    if (Number.isFinite(id) && Array.isArray(points)) byId.set(id, points);
  }
  const failed = (raw.failed ?? []).map(Number).filter((id) => Number.isFinite(id));
  return { byId, failed };
}

async function loadOneTrack(info: TrackInfo, signal?: AbortSignal): Promise<{ info: TrackInfo; tracks: TrackPoint[]; ok: boolean }> {
  const cached = trackPointCache.get(info.id);
  if (cached) return { info, tracks: cached, ok: true };
  try {
    const tracks = await fetchTracks(info.id, signal);
    rememberTracks(info.id, tracks);
    return { info, tracks, ok: true };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { info, tracks: [], ok: false };
  }
}

export type TripLoadResult = {
  trips: Trip[];
  skipped: number;
};

export type MultiTripLoadResult = {
  byUserId: Map<number, Trip[]>;
  skipped: number;
};

/** Keep first occurrence of each track info id, limited to the requested users. */
export function selectTrackInfosForUsers(infos: TrackInfo[], userIds: number[]): TrackInfo[] {
  const wanted = new Set(userIds.map(Number));
  const seen = new Set<number>();
  const out: TrackInfo[] = [];
  for (const info of infos) {
    if (!wanted.has(info.userId)) continue;
    if (seen.has(info.id)) continue;
    seen.add(info.id);
    out.push(info);
  }
  return out;
}

async function fetchTrackInfosInRange(options: {
  dateFrom: string;
  dateTo: string;
  timezone: string;
  signal?: AbortSignal;
  onProgress?: (progress: LoadProgress) => void;
}): Promise<TrackInfo[]> {
  const { dateFrom, dateTo, timezone, signal, onProgress } = options;
  const windows = updatedSinceWindows(dateFrom, dateTo);
  onProgress?.({ phase: "trips", loaded: 0, total: windows.length });

  let windowsDone = 0;
  const windowResults = await Promise.all(
    windows.map(async (day) => {
      const since = formatUpdatedSince(day, timezone);
      try {
        return await fetchTrackInfoWindow(since, signal);
      } finally {
        windowsDone += 1;
        onProgress?.({ phase: "trips", loaded: windowsDone, total: windows.length });
      }
    }),
  );

  const seen = new Set<number>();
  const infos: TrackInfo[] = [];
  for (const batch of windowResults) {
    for (const info of batch) {
      if (seen.has(info.id)) continue;
      seen.add(info.id);
      infos.push(info);
    }
  }
  return infos;
}

async function loadTracksForInfos(
  infos: TrackInfo[],
  signal?: AbortSignal,
  onProgress?: (progress: LoadProgress) => void,
): Promise<TripLoadResult> {
  onProgress?.({ phase: "tracks", loaded: 0, total: infos.length, skipped: 0 });

  const trips: Trip[] = [];
  let skipped = 0;
  let loaded = 0;

  const pushResult = (info: TrackInfo, tracks: TrackPoint[], ok: boolean) => {
    loaded += 1;
    if (!ok) {
      skipped += 1;
      return;
    }
    rememberTracks(info.id, tracks);
    if (tracks.length === 0) return;
    trips.push({
      trackInfoId: info.id,
      userId: info.userId,
      created: info.created ? new Date(info.created) : null,
      tracks,
    });
  };

  const report = () => {
    onProgress?.({
      phase: "tracks",
      loaded,
      total: infos.length,
      skipped,
    });
  };

  const loadDirect = async (items: TrackInfo[]) => {
    await mapPool(items, TRACK_FETCH_CONCURRENCY, async (info) => {
      const result = await loadOneTrack(info, signal);
      pushResult(result.info, result.tracks, result.ok);
      report();
    });
  };

  const pending = infos.filter((info) => {
    const cached = trackPointCache.get(info.id);
    if (!cached) return true;
    pushResult(info, cached, true);
    return false;
  });
  if (pending.length < infos.length) report();
  if (pending.length === 0) return { trips, skipped };

  if (batchEndpoint !== "no") {
    const chunks = chunkArray(pending, TRACK_BATCH_SIZE);
    await mapPool(chunks, TRACK_BATCH_BROWSER, async (chunk) => {
        if (batchEndpoint === "no") {
          await loadDirect(chunk);
          return;
        }
        try {
          const { byId, failed } = await fetchTracksBatch(
            chunk.map((info) => info.id),
            signal,
          );
          batchEndpoint = "yes";
          const failedSet = new Set(failed);
          const missing: TrackInfo[] = [];
          for (const info of chunk) {
            if (failedSet.has(info.id) || !byId.has(info.id)) {
              missing.push(info);
              continue;
            }
            pushResult(info, byId.get(info.id) ?? [], true);
          }
          if (missing.length) await loadDirect(missing);
          report();
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          if ((err as { batchUnavailable?: boolean }).batchUnavailable) {
            batchEndpoint = "no";
          }
          await loadDirect(chunk);
          report();
        }
      });
  } else {
    await loadDirect(pending);
  }

  return { trips, skipped };
}

export async function loadTripsForUser(options: {
  userId: number;
  dateFrom: string;
  dateTo: string;
  timezone: string;
  signal?: AbortSignal;
  onProgress?: (progress: LoadProgress) => void;
}): Promise<TripLoadResult> {
  const infos = await fetchTrackInfosInRange(options);
  const forUser = selectTrackInfosForUsers(infos, [Number(options.userId)]);
  return loadTracksForInfos(forUser, options.signal, options.onProgress);
}

export async function loadTripsForUsers(options: {
  userIds: number[];
  dateFrom: string;
  dateTo: string;
  timezone: string;
  signal?: AbortSignal;
  onProgress?: (progress: LoadProgress) => void;
}): Promise<MultiTripLoadResult> {
  const userIds = [...new Set(options.userIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  const byUserId = new Map<number, Trip[]>();
  for (const id of userIds) byUserId.set(id, []);
  if (userIds.length === 0) return { byUserId, skipped: 0 };

  const infos = await fetchTrackInfosInRange(options);
  const selected = selectTrackInfosForUsers(infos, userIds);
  const loaded = await loadTracksForInfos(selected, options.signal, options.onProgress);
  for (const trip of loaded.trips) {
    const list = byUserId.get(trip.userId);
    if (list) list.push(trip);
    else byUserId.set(trip.userId, [trip]);
  }
  return { byUserId, skipped: loaded.skipped };
}

export function userLabel(user: User): string {
  return user.name || user.username || `User ${user.id}`;
}
