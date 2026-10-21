import { DEFAULT_MIN_SPEED_KMH, DEFAULT_TRIP_BREAK_MIN } from "./config";

export const TRIP_MODES = ["default", "speed", "ignition"] as const;
export type TripMode = (typeof TRIP_MODES)[number];

export type DeviceTripConfig = {
  tripMode: TripMode;
  minSpeedKmh: number;
  tripBreakMin: number;
};

export const DEFAULT_TRIP_CONFIG: DeviceTripConfig = {
  tripMode: "default",
  minSpeedKmh: DEFAULT_MIN_SPEED_KMH,
  tripBreakMin: DEFAULT_TRIP_BREAK_MIN,
};

export function isTripMode(value: unknown): value is TripMode {
  return value === "default" || value === "speed" || value === "ignition";
}

export function normalizeTripConfig(raw?: {
  tripMode?: unknown;
  trip_mode?: unknown;
  minSpeedKmh?: unknown;
  tripMinSpeedKmh?: unknown;
  trip_min_speed_kmh?: unknown;
  tripBreakMin?: unknown;
  trip_break_min?: unknown;
} | null): DeviceTripConfig {
  const modeRaw = raw?.tripMode ?? raw?.trip_mode;
  const speedRaw = raw?.minSpeedKmh ?? raw?.tripMinSpeedKmh ?? raw?.trip_min_speed_kmh;
  const breakRaw = raw?.tripBreakMin ?? raw?.trip_break_min;
  const speed = Number(speedRaw);
  const brk = Number(breakRaw);
  return {
    tripMode: isTripMode(modeRaw) ? modeRaw : "default",
    minSpeedKmh: Number.isFinite(speed) && speed >= 0 ? speed : DEFAULT_MIN_SPEED_KMH,
    tripBreakMin: Number.isFinite(brk) && brk >= 1 ? brk : DEFAULT_TRIP_BREAK_MIN,
  };
}

export const TRIP_MODE_OPTIONS: Array<{ value: TripMode; label: string; hint: string }> = [
  {
    value: "default",
    label: "Default (hybrid)",
    hint: "Start when speed > threshold. End on ignition off, GPS gap, or parked for the break.",
  },
  {
    value: "speed",
    label: "Speed only",
    hint: "Ignore ignition. Start when moving; end when parked for the break or GPS gap.",
  },
  {
    value: "ignition",
    label: "Ignition only",
    hint: "Start on ignition on, end on ignition off. Optional min speed ignores crawl.",
  },
];
