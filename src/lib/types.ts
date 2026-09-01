export type Period = "daily" | "weekly" | "monthly";

export type Group = {
  id: number;
  name: string;
  usersIds: number[];
};

export type User = {
  id: number;
  name?: string;
  username?: string;
};

export type TrackInfo = {
  id: number;
  userId: number;
  created?: string;
};

export type TrackPoint = {
  utc?: string;
  position?: {
    latitude?: number | string;
    longitude?: number | string;
    altitude?: number | string;
  };
  variables?: Record<string, unknown>;
};

export type Trip = {
  trackInfoId: number;
  userId: number;
  created: Date | null;
  tracks: TrackPoint[];
};

export type PeriodMetrics = {
  key: string;
  label: string;
  gpsDistanceKm: number;
  ignitionDistanceKm: number;
  odometerKm: number;
  activeHours: number;
  idleHours: number;
  fuelUsedL: number;
  fuelSource: "can" | "tank" | "none";
  canFuelUsedL: number;
  tankFuelUsedL: number;
  refillL: number;
  refillEvents: number;
  fuelCost: number;
  costPerKm: number;
  kmPerL: number;
  lPerKm: number;
  elevationGainM: number;
  elevationLossM: number;
  altitudeMinM: number | null;
  altitudeMaxM: number | null;
  altitudeSamples: number;
  terrainImpactPct: number;
  flatKmPerL: number;
  roadSmoothCount: number;
  roadRoughCount: number;
  roadBumpyCount: number;
  roadSamples: number;
  roadSmoothPct: number;
  roadRoughPct: number;
  roadBumpyPct: number;
  avgVibrationMg: number;
  maxVibrationMg: number;
  tripCount: number;
  pointCount: number;
  calendarDays: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  speedSamples: number;
  avgRpm: number;
  maxRpm: number;
  rpmSamples: number;
};

export type LoadProgress = {
  phase: "trips" | "tracks";
  loaded: number;
  total: number;
  skipped?: number;
};
