/**
 * Parse a map lat/lon pair. Rejects missing values and Null Island (0,0)
 * so unfinished GPS never plots in the ocean.
 */
export function asMapCoord(lat: unknown, lon: unknown): [number, number] | null {
  if (lat == null || lon == null || lat === "" || lon === "") return null;
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return [a, b];
}
