import { FLEET_VEHICLE_CAP } from "./config";

const KEY = "fms-embed:last-vehicle";

export type LastUsed = {
  groupId: string;
  userId: string;
  fleetUserIds: string[];
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!/^\d+$/.test(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out.slice(0, FLEET_VEHICLE_CAP);
}

export function parseUserIdsSearch(search: string): string[] {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const listed = (params.get("userIds") ?? "").split(/[,\s]+/);
  return uniqueIds(listed);
}

export function readLastUsed(storage?: StorageLike | null): LastUsed | null {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastUsed>;
    if (!parsed || typeof parsed.groupId !== "string") return null;
    return {
      groupId: parsed.groupId,
      userId: typeof parsed.userId === "string" && /^\d+$/.test(parsed.userId) ? parsed.userId : "",
      fleetUserIds: Array.isArray(parsed.fleetUserIds) ? uniqueIds(parsed.fleetUserIds.map(String)) : [],
    };
  } catch {
    return null;
  }
}

function save(value: LastUsed, storage?: StorageLike | null) {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Remember the single vehicle last opened on the main or compact page. */
export function writeLastVehicle(groupId: string, userId: string, storage?: StorageLike | null) {
  if (!groupId || !/^\d+$/.test(userId)) return;
  const prev = readLastUsed(storage);
  save(
    {
      groupId,
      userId,
      fleetUserIds: prev?.groupId === groupId ? prev.fleetUserIds : [],
    },
    storage,
  );
}

/** Remember the fleet checkbox set for a group. */
export function writeFleetSelection(groupId: string, userIds: string[], storage?: StorageLike | null) {
  if (!groupId) return;
  const ids = uniqueIds(userIds);
  const prev = readLastUsed(storage);
  save(
    {
      groupId,
      userId: ids[0] || (prev?.groupId === groupId ? prev.userId : "") || "",
      fleetUserIds: ids,
    },
    storage,
  );
}

/**
 * Seed the fleet picker.
 * Explicit `userIds` query wins. Arriving with only `userId` (from Full/Compact) uses that
 * last-used vehicle alone. Refreshing a fleet URL restores the stored fleet set.
 */
export function defaultFleetUserIds(options: {
  groupId: string;
  queryUserIds: string[];
  queryUserId: string;
  allowedIds?: string[];
  storage?: StorageLike | null;
}): string[] {
  let ids: string[] = [];
  if (options.queryUserIds.length) {
    ids = uniqueIds(options.queryUserIds);
  } else if (options.queryUserId && /^\d+$/.test(options.queryUserId)) {
    ids = [options.queryUserId];
  } else {
    const last = readLastUsed(options.storage);
    if (last && last.groupId === options.groupId) {
      if (last.fleetUserIds.length) ids = last.fleetUserIds;
      else if (last.userId) ids = [last.userId];
    }
  }

  if (options.allowedIds && options.allowedIds.length > 0) {
    const allow = new Set(options.allowedIds);
    ids = ids.filter((id) => allow.has(id));
  }
  return uniqueIds(ids);
}
