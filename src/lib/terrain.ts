import {
  MAX_ALTITUDE_JUMP_M,
  MAX_GAP_MS,
  MAX_POSITION_JUMP_KM,
  MAX_VERTICAL_SPEED_MS,
  MIN_ALTITUDE_STEP_M,
  TERRAIN_GAIN_PCT_PER_M_PER_KM,
} from "./config";
import { haversineKm } from "./geo";

export type AltitudeSample = {
  ms: number;
  alt: number;
  lat: number | null;
  lon: number | null;
};

export type ElevationStats = {
  gainM: number;
  lossM: number;
  minM: number | null;
  maxM: number | null;
  samples: number;
};

/**
 * Thresholded cumulative climb/descent.
 * Small GPS dither is ignored until altitude has moved at least MIN_ALTITUDE_STEP_M
 * from the last counted point. Impossible jumps rebase without adding to gain/loss.
 */
export function elevationFromSamples(samples: AltitudeSample[]): ElevationStats {
  const sorted = [...samples].sort((a, b) => a.ms - b.ms);
  let gainM = 0;
  let lossM = 0;
  let minM: number | null = null;
  let maxM: number | null = null;
  let lastCounted: AltitudeSample | null = null;
  let prev: AltitudeSample | null = null;

  for (const sample of sorted) {
    minM = minM === null ? sample.alt : Math.min(minM, sample.alt);
    maxM = maxM === null ? sample.alt : Math.max(maxM, sample.alt);

    if (!lastCounted || !prev) {
      lastCounted = sample;
      prev = sample;
      continue;
    }

    const dtMs = sample.ms - prev.ms;
    const gap = dtMs <= 0 || dtMs > MAX_GAP_MS;
    const posJump =
      prev.lat !== null &&
      prev.lon !== null &&
      sample.lat !== null &&
      sample.lon !== null &&
      haversineKm(prev.lat, prev.lon, sample.lat, sample.lon) > MAX_POSITION_JUMP_KM;

    prev = sample;

    if (gap || posJump) {
      lastCounted = sample;
      continue;
    }

    const d = sample.alt - lastCounted.alt;
    const dt = (sample.ms - lastCounted.ms) / 1000;
    const abs = Math.abs(d);
    if (dt <= 0) continue;

    if (abs > MAX_ALTITUDE_JUMP_M || abs / dt > MAX_VERTICAL_SPEED_MS) {
      lastCounted = sample;
      continue;
    }

    if (d >= MIN_ALTITUDE_STEP_M) {
      gainM += d;
      lastCounted = sample;
    } else if (d <= -MIN_ALTITUDE_STEP_M) {
      lossM += -d;
      lastCounted = sample;
    }
  }

  return {
    gainM,
    lossM,
    minM,
    maxM,
    samples: sorted.length,
  };
}

/** Percent extra fuel vs a flat route: (gain_m × 0.1) / distance_km. */
export function terrainImpactPct(gainM: number, distanceKm: number): number {
  if (gainM <= 0 || distanceKm <= 0) return 0;
  return (gainM * TERRAIN_GAIN_PCT_PER_M_PER_KM) / distanceKm;
}

/**
 * km/l that would be expected on flat terrain given the same driving.
 * Hills cost fuel, so this is higher than actual km/l when there is gain.
 * V8 divided instead of multiplying, which inverted the adjustment.
 */
export function flatEquivalentKmPerL(kmPerL: number, impactPct: number): number {
  if (kmPerL <= 0) return 0;
  return kmPerL * (1 + Math.max(0, impactPct) / 100);
}
