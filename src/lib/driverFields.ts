import { fetchUserCustomFields, type CustomField } from "./api";

/** Common Armada CF names for “who is driving this vehicle”. */
export const DRIVER_FIELD_NAME_HINTS = [
  "driver",
  "driver name",
  "drivername",
  "assigned driver",
  "current driver",
  "pengemudi",
  "nama pengemudi",
  "sopir",
  "nama sopir",
  "operator",
  "nama operator",
];

/**
 * Pick a driver display value from custom fields.
 * Exact/near name match first; otherwise first non-empty field whose name contains “driver”/“pengemudi”/“sopir”.
 */
export function pickDriverFromCustomFields(fields: CustomField[]): string {
  if (!fields.length) return "";
  const byLower = new Map(fields.map((f) => [f.name.trim().toLowerCase(), f.value.trim()]));
  for (const hint of DRIVER_FIELD_NAME_HINTS) {
    const value = byLower.get(hint);
    if (value) return value;
  }
  for (const field of fields) {
    const name = field.name.trim().toLowerCase();
    const value = field.value.trim();
    if (!value) continue;
    if (/(^|[^a-z])(driver|pengemudi|sopir)([^a-z]|$)/i.test(name)) return value;
  }
  return "";
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i]!);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return out;
}

/** Fetch Armada custom fields per user and return id → driver name (empty string if none). */
export async function fetchDriverMap(
  userIds: number[],
  signal?: AbortSignal,
  concurrency = 4,
): Promise<Record<number, string>> {
  const ids = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
  const out: Record<number, string> = {};
  if (!ids.length) return out;
  await mapPool(ids, concurrency, async (id) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const fields = await fetchUserCustomFields(id, signal);
      out[id] = pickDriverFromCustomFields(fields);
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      out[id] = "";
    }
    return id;
  });
  return out;
}
