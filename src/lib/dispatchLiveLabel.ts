import type { DispatchLiveDriver, DispatchLivePosition } from "./dispatch";

/** Compact age for a live fix: "12s", "4m", "1h 20m". */
export function formatFixAge(ageSec: number | null | undefined): string {
  if (ageSec == null || !Number.isFinite(ageSec)) return "";
  const sec = Math.max(0, Math.round(ageSec));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/**
 * Phone/vehicle disagreement, worded from the source that is currently shown.
 * This is not distance-from-plan — that lives on the manifest stop row.
 */
export function liveSeparationPhrase(
  source: DispatchLivePosition["source"] | string | null | undefined,
  km: number | null | undefined,
): string {
  if (km == null || !Number.isFinite(km) || km < 0.2) return "";
  const other = source === "phone" ? "vehicle" : "driver phone";
  return `${km.toFixed(1)} km from ${other}`;
}

/**
 * Where this driver's dot is coming from. Dispatchers act differently on a
 * 12-second-old phone fix than on a vehicle tracker with no timestamp.
 */
export function livePositionLabel(driver: Pick<DispatchLiveDriver, "livePosition" | "liveLat" | "liveLon">): {
  text: string;
  stale: boolean;
} | null {
  const pos = driver.livePosition;
  if (!pos) {
    if (driver.liveLat == null || driver.liveLon == null) return null;
    return { text: "Position reported", stale: false };
  }
  const parts: string[] = [];
  if (pos.source === "phone") {
    const age = formatFixAge(pos.ageSec);
    parts.push(age ? `Driver phone · ${age} ago` : "Driver phone");
  } else {
    parts.push("Vehicle GPS");
  }
  const gap = liveSeparationPhrase(pos.source, pos.phoneSeparationKm);
  if (gap) parts.push(gap);
  const stale = pos.source === "phone" && pos.ageSec != null && pos.ageSec > 300;
  return { text: parts.join(" · "), stale };
}
