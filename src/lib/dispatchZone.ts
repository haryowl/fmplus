/** Fold free-text zone labels for matching (Dago / dago / " Dago "). */
export function normalizeZoneKey(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

/** Sentinel filter value for orders with no zone. */
export const ZONE_FILTER_NONE = "__none__";
