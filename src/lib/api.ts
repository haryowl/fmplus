import { API_BASE } from "./config";
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

function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get("Retry-After");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 4_000);
    }
  }
  return Math.min(300 * 2 ** attempt, 2_000);
}

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let lastStatus = 0;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { accept: "application/json" },
      signal,
    });
    lastStatus = res.status;

    if (res.status === 429 || res.status === 503) {
      await wait(retryDelayMs(res, attempt), signal);
      continue;
    }

    if (!res.ok) {
      throw new Error(`Armada ${res.status} on ${path}`);
    }

    return res.json() as Promise<T>;
  }

  throw new Error(`Armada ${lastStatus} on ${path} after retries`);
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
  const batchSize = 2;

  for (let i = 0; i < infos.length; i += batchSize) {
    if (signal?.aborted) break;
    const batch = infos.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (info) => {
        try {
          const tracks = await fetchTracks(info.id, signal);
          return { info, tracks, ok: true as const };
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          return { info, tracks: [] as TrackPoint[], ok: false as const };
        }
      }),
    );

    for (const result of results) {
      if (!result.ok) {
        skipped += 1;
        continue;
      }
      if (result.tracks.length === 0) continue;
      trips.push({
        trackInfoId: result.info.id,
        userId: result.info.userId,
        created: result.info.created ? new Date(result.info.created) : null,
        tracks: result.tracks,
      });
    }

    onProgress?.({
      phase: "tracks",
      loaded: Math.min(i + batch.length, infos.length),
      total: infos.length,
      skipped,
    });
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
