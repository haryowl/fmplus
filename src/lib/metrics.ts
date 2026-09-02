import {
  DEFAULT_FUEL_PRICE,
  DEFAULT_MIN_SPEED_KMH,
  DEFAULT_REFILL_THRESHOLD_L,
  DEFAULT_TRIP_BREAK_MIN,
  MAX_GAP_MS,
  MAX_HOURS_PER_DAY,
  MAX_POSITION_JUMP_KM,
  REFILL_STEP_L,
  REFILL_WINDOW_MS,
} from "./config";
import { asNumber, haversineKm } from "./geo";
import { elevationFromSamples, flatEquivalentKmPerL, terrainImpactPct } from "./terrain";
import { roadFromSamples, roadSharePct } from "./road";
import { dateKeyInOffset, periodKey, periodLabel, zonedEndMs, zonedStartMs } from "./time";
import { assignLogicalTrips } from "./trips";
import type { Period, PeriodMetrics, TrackPoint, Trip } from "./types";

type Sample = {
  ms: number;
  dateKey: string;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  ignition: boolean;
  speedKmh: number;
  rpm: number | null;
  odometerKm: number | null;
  fuelConsumed: number | null;
  fuelLevel: number | null;
  axisX: number | null;
  axisY: number | null;
  axisZ: number | null;
  tripId: number;
  logicalTripId: number | null;
};

function isIgnitionOn(variables: Record<string, unknown> | undefined): boolean {
  return variables?.ignition === true;
}

function fuelLevelOf(variables: Record<string, unknown> | undefined): number | null {
  if (!variables) return null;
  return asNumber(variables["fuel level"] ?? variables.fuelLevel ?? variables.FuelLevel);
}

function toSample(point: TrackPoint, offset: string, tripId: number): Sample | null {
  if (!point.utc) return null;
  const ms = Date.parse(point.utc);
  if (!Number.isFinite(ms)) return null;

  const lat = asNumber(point.position?.latitude);
  const lon = asNumber(point.position?.longitude);
  const speedMs = asNumber(point.variables?.speed);
  const odoM = asNumber(point.variables?.odometerAcc);
  const rpm = asNumber(point.variables?.caN300_EngineRPM);

  return {
    ms,
    dateKey: dateKeyInOffset(ms, offset),
    lat,
    lon,
    altitude: asNumber(point.position?.altitude),
    ignition: isIgnitionOn(point.variables),
    speedKmh: speedMs === null ? 0 : speedMs * 3.6,
    rpm,
    odometerKm: odoM === null ? null : odoM / 1000,
    fuelConsumed: asNumber(point.variables?.caN300_FuelConsumed),
    fuelLevel: fuelLevelOf(point.variables),
    axisX: asNumber(point.variables?.axisX ?? point.variables?.AxisX),
    axisY: asNumber(point.variables?.axisY ?? point.variables?.AxisY),
    axisZ: asNumber(point.variables?.axisZ ?? point.variables?.AxisZ),
    tripId,
    logicalTripId: null,
  };
}

function addCapped(
  daily: Record<string, number>,
  dateKey: string,
  seconds: number,
): number {
  if (!daily[dateKey]) daily[dateKey] = 0;
  const remaining = MAX_HOURS_PER_DAY * 3600 - daily[dateKey];
  const add = Math.min(seconds, Math.max(0, remaining));
  daily[dateKey] += add;
  return add;
}

type FuelSample = {
  ms: number;
  level: number;
  speed: number;
  lat: number | null;
  lon: number | null;
};

export type RefillEvent = {
  ms: number;
  liters: number;
  lat: number | null;
  lon: number | null;
};

/** Rising tank at low speed, including a parked jump after a longer gap. */
function detectRefills(
  samples: Sample[],
  thresholdL: number,
  maxSpeedKmh: number,
): { liters: number; events: RefillEvent[] } {
  const levels: FuelSample[] = samples
    .filter((s) => s.fuelLevel !== null)
    .map((s) => ({
      ms: s.ms,
      level: s.fuelLevel as number,
      speed: s.speedKmh,
      lat: s.lat,
      lon: s.lon,
    }))
    .sort((a, b) => a.ms - b.ms);

  if (levels.length < 2) return { liters: 0, events: [] };

  const events: RefillEvent[] = [];
  let liters = 0;
  let seqStart: FuelSample | null = null;
  let seqLast = levels[0];

  const pushEvent = (at: FuelSample, jump: number) => {
    events.push({
      ms: at.ms,
      liters: jump,
      lat: at.lat,
      lon: at.lon,
    });
    liters += jump;
  };

  const closeSeq = () => {
    if (!seqStart) return;
    const jump = seqLast.level - seqStart.level;
    if (jump >= thresholdL) pushEvent(seqLast, jump);
    seqStart = null;
  };

  for (let i = 1; i < levels.length; i += 1) {
    const prev = levels[i - 1];
    const cur = levels[i];
    const diff = cur.level - prev.level;
    const dt = cur.ms - prev.ms;
    const slow = cur.speed <= maxSpeedKmh;

    if (diff >= REFILL_STEP_L && slow && dt > 0 && dt <= REFILL_WINDOW_MS) {
      if (!seqStart) seqStart = prev;
      seqLast = cur;
      continue;
    }

    closeSeq();

    if (diff >= thresholdL && slow && dt > 0) {
      pushEvent(cur, diff);
    }
  }

  closeSeq();
  return { liters, events };
}

function detectRefillLiters(
  samples: Sample[],
  thresholdL: number,
  maxSpeedKmh: number,
): { liters: number; events: number } {
  const found = detectRefills(samples, thresholdL, maxSpeedKmh);
  return { liters: found.liters, events: found.events.length };
}

function canFuelUsedL(samples: Sample[]): number {
  const values = samples
    .filter((s) => s.fuelConsumed !== null && (s.fuelConsumed as number) > 0)
    .sort((a, b) => a.ms - b.ms);
  if (values.length < 2) return 0;
  const first = values[0].fuelConsumed as number;
  const last = values[values.length - 1].fuelConsumed as number;
  return Math.max(0, last - first);
}

/**
 * Tank sender: consumption is the drop in level, putting refill liters back
 * so a fill during the period is not treated as negative use.
 * used = first + refill − last
 */
function tankFuelUsedL(samples: Sample[], refillL: number): number {
  const levels = samples
    .filter((s) => s.fuelLevel !== null)
    .sort((a, b) => a.ms - b.ms);
  if (levels.length < 2) return 0;
  const first = levels[0].fuelLevel as number;
  const last = levels[levels.length - 1].fuelLevel as number;
  return Math.max(0, first + refillL - last);
}

function accumulate(
  samples: Sample[],
  minSpeedKmh: number,
  refillThresholdL: number,
): Omit<
  PeriodMetrics,
  | "key"
  | "label"
  | "tripCount"
  | "fuelCost"
  | "costPerKm"
  | "kmPerL"
  | "lPerKm"
  | "terrainImpactPct"
  | "flatKmPerL"
  | "roadSmoothPct"
  | "roadRoughPct"
  | "roadBumpyPct"
> {
  const sorted = [...samples].sort((a, b) => a.ms - b.ms);
  let gps = 0;
  let ignition = 0;
  let odometer = 0;
  let activeSeconds = 0;
  let idleSeconds = 0;
  const dailyEngine: Record<string, number> = {};
  const dateKeys = new Set<string>();

  let prevAll: Sample | null = null;
  let prevIgn: Sample | null = null;
  let prevOdo: number | null = null;
  let prev: Sample | null = null;
  let speedSum = 0;
  let speedSamples = 0;
  let maxSpeedKmh = 0;
  let rpmSum = 0;
  let rpmSamples = 0;
  let maxRpm = 0;

  for (const sample of sorted) {
    dateKeys.add(sample.dateKey);

    if (sample.speedKmh > 0) {
      speedSum += sample.speedKmh;
      speedSamples += 1;
      if (sample.speedKmh > maxSpeedKmh) maxSpeedKmh = sample.speedKmh;
    }
    if (sample.rpm !== null && sample.rpm > 0) {
      rpmSum += sample.rpm;
      rpmSamples += 1;
      if (sample.rpm > maxRpm) maxRpm = sample.rpm;
    }

    if (prev) {
      const dt = (sample.ms - prev.ms) / 1000;
      if (dt > 0 && dt * 1000 <= MAX_GAP_MS) {
        if (prev.ignition) {
          const added = addCapped(dailyEngine, prev.dateKey, dt);
          if (prev.speedKmh > minSpeedKmh) activeSeconds += added;
          else idleSeconds += added;
        }
      }
    }
    prev = sample;

    if (sample.lat !== null && sample.lon !== null) {
      if (prevAll?.lat !== null && prevAll?.lon !== null && prevAll) {
        const dist = haversineKm(prevAll.lat, prevAll.lon, sample.lat, sample.lon);
        if (dist <= MAX_POSITION_JUMP_KM) gps += dist;
      }
      prevAll = sample;

      if (sample.ignition) {
        if (prevIgn?.lat !== null && prevIgn?.lon !== null && prevIgn) {
          const dist = haversineKm(prevIgn.lat, prevIgn.lon, sample.lat, sample.lon);
          if (dist <= MAX_POSITION_JUMP_KM) ignition += dist;
        }
        prevIgn = sample;
      }
    }

    if (sample.ignition && sample.odometerKm !== null && sample.odometerKm > 0) {
      if (prevOdo !== null && prevOdo > 0) {
        const delta = sample.odometerKm - prevOdo;
        if (delta > 0) odometer += delta;
      }
      prevOdo = sample.odometerKm;
    }
  }

  const refill = detectRefillLiters(sorted, refillThresholdL, minSpeedKmh);
  const canUsed = canFuelUsedL(sorted);
  const tankUsed = tankFuelUsedL(sorted, refill.liters);
  const fuel =
    canUsed > 0
      ? { used: canUsed, source: "can" as const }
      : tankUsed > 0
        ? { used: tankUsed, source: "tank" as const }
        : { used: 0, source: "none" as const };
  const days = Math.max(1, dateKeys.size);
  const elevation = elevationFromSamples(
    sorted
      .filter((s) => s.altitude !== null)
      .map((s) => ({
        ms: s.ms,
        alt: s.altitude as number,
        lat: s.lat,
        lon: s.lon,
      })),
  );
  const road = roadFromSamples(
    sorted
      .filter((s) => s.axisX !== null && s.axisY !== null && s.axisZ !== null)
      .map((s) => ({ x: s.axisX as number, y: s.axisY as number, z: s.axisZ as number })),
  );

  return {
    gpsDistanceKm: gps,
    ignitionDistanceKm: ignition,
    odometerKm: odometer,
    activeHours: Math.min(activeSeconds / 3600, days * MAX_HOURS_PER_DAY),
    idleHours: Math.min(idleSeconds / 3600, days * MAX_HOURS_PER_DAY),
    fuelUsedL: fuel.used,
    fuelSource: fuel.source,
    canFuelUsedL: canUsed,
    tankFuelUsedL: tankUsed,
    refillL: refill.liters,
    refillEvents: refill.events,
    pointCount: sorted.length,
    calendarDays: dateKeys.size,
    avgSpeedKmh: speedSamples > 0 ? speedSum / speedSamples : 0,
    maxSpeedKmh,
    speedSamples,
    avgRpm: rpmSamples > 0 ? rpmSum / rpmSamples : 0,
    maxRpm,
    rpmSamples,
    elevationGainM: elevation.gainM,
    elevationLossM: elevation.lossM,
    altitudeMinM: elevation.minM,
    altitudeMaxM: elevation.maxM,
    altitudeSamples: elevation.samples,
    roadSmoothCount: road.smoothCount,
    roadRoughCount: road.roughCount,
    roadBumpyCount: road.bumpyCount,
    roadSamples: road.samples,
    avgVibrationMg: road.avgVibrationMg,
    maxVibrationMg: road.maxVibrationMg,
  };
}

function withCosts(
  stats: ReturnType<typeof accumulate>,
  key: string,
  period: Period,
  fuelPrice: number,
  tripCount: number,
): PeriodMetrics {
  const fuelCost = stats.fuelUsedL * fuelPrice;
  const dist = stats.gpsDistanceKm;
  const kmPerL = stats.fuelUsedL > 0 ? dist / stats.fuelUsedL : 0;
  const impact = terrainImpactPct(stats.elevationGainM, dist);
  return {
    key,
    label: periodLabel(key, period),
    gpsDistanceKm: stats.gpsDistanceKm,
    ignitionDistanceKm: stats.ignitionDistanceKm,
    odometerKm: stats.odometerKm,
    activeHours: stats.activeHours,
    idleHours: stats.idleHours,
    fuelUsedL: stats.fuelUsedL,
    fuelSource: stats.fuelSource,
    canFuelUsedL: stats.canFuelUsedL,
    tankFuelUsedL: stats.tankFuelUsedL,
    refillL: stats.refillL,
    refillEvents: stats.refillEvents,
    fuelCost,
    costPerKm: dist > 0 ? fuelCost / dist : 0,
    kmPerL,
    lPerKm: dist > 0 ? stats.fuelUsedL / dist : 0,
    tripCount,
    pointCount: stats.pointCount,
    calendarDays: stats.calendarDays,
    avgSpeedKmh: stats.avgSpeedKmh,
    maxSpeedKmh: stats.maxSpeedKmh,
    speedSamples: stats.speedSamples,
    avgRpm: stats.avgRpm,
    maxRpm: stats.maxRpm,
    rpmSamples: stats.rpmSamples,
    elevationGainM: stats.elevationGainM,
    elevationLossM: stats.elevationLossM,
    altitudeMinM: stats.altitudeMinM,
    altitudeMaxM: stats.altitudeMaxM,
    altitudeSamples: stats.altitudeSamples,
    terrainImpactPct: impact,
    flatKmPerL: flatEquivalentKmPerL(kmPerL, impact),
    roadSmoothCount: stats.roadSmoothCount,
    roadRoughCount: stats.roadRoughCount,
    roadBumpyCount: stats.roadBumpyCount,
    roadSamples: stats.roadSamples,
    roadSmoothPct: roadSharePct(stats.roadSmoothCount, stats.roadSamples),
    roadRoughPct: roadSharePct(stats.roadRoughCount, stats.roadSamples),
    roadBumpyPct: roadSharePct(stats.roadBumpyCount, stats.roadSamples),
    avgVibrationMg: stats.avgVibrationMg,
    maxVibrationMg: stats.maxVibrationMg,
  };
}

function samplesInRange(
  trips: Trip[],
  options: { dateFrom: string; dateTo: string; timezone: string },
): Sample[] {
  const startMs = zonedStartMs(options.dateFrom, options.timezone);
  const endMs = zonedEndMs(options.dateTo, options.timezone);
  const inRange: Sample[] = [];
  for (const trip of trips) {
    for (const point of trip.tracks) {
      const sample = toSample(point, options.timezone, trip.trackInfoId);
      if (!sample) continue;
      if (sample.ms < startMs || sample.ms > endMs) continue;
      inRange.push(sample);
    }
  }
  return inRange;
}

export function computePeriodMetrics(
  trips: Trip[],
  options: {
    period: Period;
    dateFrom: string;
    dateTo: string;
    timezone: string;
    minSpeedKmh?: number;
    refillThresholdL?: number;
    fuelPricePerL?: number;
    tripBreakMin?: number;
  },
): PeriodMetrics[] {
  const minSpeed = options.minSpeedKmh ?? DEFAULT_MIN_SPEED_KMH;
  const refillThreshold = options.refillThresholdL ?? DEFAULT_REFILL_THRESHOLD_L;
  const fuelPrice = options.fuelPricePerL ?? DEFAULT_FUEL_PRICE;
  const breakMs = (options.tripBreakMin ?? DEFAULT_TRIP_BREAK_MIN) * 60 * 1000;
  const inRange = samplesInRange(trips, options);

  const tripStarts = assignLogicalTrips(inRange, { minSpeedKmh: minSpeed, breakMs });
  const startsByPeriod = new Map<string, number>();
  for (const dateKey of tripStarts.values()) {
    const key = periodKey(dateKey, options.period);
    startsByPeriod.set(key, (startsByPeriod.get(key) ?? 0) + 1);
  }

  const buckets = new Map<string, Sample[]>();
  for (const sample of inRange) {
    const key = periodKey(sample.dateKey, options.period);
    const list = buckets.get(key);
    if (list) list.push(sample);
    else buckets.set(key, [sample]);
  }

  return [...buckets.keys()]
    .sort()
    .map((key) => {
      const samples = buckets.get(key) ?? [];
      const stats = accumulate(samples, minSpeed, refillThreshold);
      return withCosts(stats, key, options.period, fuelPrice, startsByPeriod.get(key) ?? 0);
    });
}

/** Tank-rise events in range, with GPS when the sample has a fix. Same rule as the Fuel panel. */
export function listRefillEvents(
  trips: Trip[],
  options: {
    dateFrom: string;
    dateTo: string;
    timezone: string;
    minSpeedKmh?: number;
    refillThresholdL?: number;
  },
): RefillEvent[] {
  const minSpeed = options.minSpeedKmh ?? DEFAULT_MIN_SPEED_KMH;
  const refillThreshold = options.refillThresholdL ?? DEFAULT_REFILL_THRESHOLD_L;
  const samples = samplesInRange(trips, options);
  return detectRefills(samples, refillThreshold, minSpeed).events.filter(
    (event) => event.lat !== null && event.lon !== null,
  );
}

export function sumMetrics(rows: PeriodMetrics[]) {
  const acc = rows.reduce(
    (sum, row) => {
      sum.gps += row.gpsDistanceKm;
      sum.ignition += row.ignitionDistanceKm;
      sum.odometer += row.odometerKm;
      sum.hours += row.activeHours;
      sum.idle += row.idleHours;
      sum.fuel += row.fuelUsedL;
      sum.canFuel += row.canFuelUsedL;
      sum.tankFuel += row.tankFuelUsedL;
      sum.refill += row.refillL;
      sum.refillEvents += row.refillEvents;
      sum.cost += row.fuelCost;
      sum.trips += row.tripCount;
      sum.points += row.pointCount;
      sum.days += row.calendarDays;
      sum.speedWeighted += row.avgSpeedKmh * row.speedSamples;
      sum.speedSamples += row.speedSamples;
      sum.maxSpeed = Math.max(sum.maxSpeed, row.maxSpeedKmh);
      sum.rpmWeighted += row.avgRpm * row.rpmSamples;
      sum.rpmSamples += row.rpmSamples;
      sum.maxRpm = Math.max(sum.maxRpm, row.maxRpm);
      sum.elevationGainM += row.elevationGainM;
      sum.elevationLossM += row.elevationLossM;
      sum.altitudeSamples += row.altitudeSamples;
      if (row.altitudeMinM !== null) {
        sum.altitudeMinM =
          sum.altitudeMinM === null ? row.altitudeMinM : Math.min(sum.altitudeMinM, row.altitudeMinM);
      }
      if (row.altitudeMaxM !== null) {
        sum.altitudeMaxM =
          sum.altitudeMaxM === null ? row.altitudeMaxM : Math.max(sum.altitudeMaxM, row.altitudeMaxM);
      }
      sum.roadSmoothCount += row.roadSmoothCount;
      sum.roadRoughCount += row.roadRoughCount;
      sum.roadBumpyCount += row.roadBumpyCount;
      sum.vibrationWeighted += row.avgVibrationMg * row.roadSamples;
      sum.roadSamples += row.roadSamples;
      sum.maxVibrationMg = Math.max(sum.maxVibrationMg, row.maxVibrationMg);
      return sum;
    },
    {
      gps: 0,
      ignition: 0,
      odometer: 0,
      hours: 0,
      idle: 0,
      fuel: 0,
      canFuel: 0,
      tankFuel: 0,
      refill: 0,
      refillEvents: 0,
      cost: 0,
      trips: 0,
      points: 0,
      days: 0,
      speedWeighted: 0,
      speedSamples: 0,
      maxSpeed: 0,
      rpmWeighted: 0,
      rpmSamples: 0,
      maxRpm: 0,
      elevationGainM: 0,
      elevationLossM: 0,
      altitudeMinM: null as number | null,
      altitudeMaxM: null as number | null,
      altitudeSamples: 0,
      roadSmoothCount: 0,
      roadRoughCount: 0,
      roadBumpyCount: 0,
      roadSamples: 0,
      vibrationWeighted: 0,
      maxVibrationMg: 0,
    },
  );

  const kmPerL = acc.fuel > 0 ? acc.gps / acc.fuel : 0;
  const impact = terrainImpactPct(acc.elevationGainM, acc.gps);

  return {
    gps: acc.gps,
    ignition: acc.ignition,
    odometer: acc.odometer,
    hours: acc.hours,
    idle: acc.idle,
    fuel: acc.fuel,
    canFuel: acc.canFuel,
    tankFuel: acc.tankFuel,
    refill: acc.refill,
    refillEvents: acc.refillEvents,
    cost: acc.cost,
    trips: acc.trips,
    points: acc.points,
    days: acc.days,
    avgSpeed: acc.speedSamples > 0 ? acc.speedWeighted / acc.speedSamples : 0,
    maxSpeed: acc.maxSpeed,
    avgRpm: acc.rpmSamples > 0 ? acc.rpmWeighted / acc.rpmSamples : 0,
    maxRpm: acc.maxRpm,
    elevationGainM: acc.elevationGainM,
    elevationLossM: acc.elevationLossM,
    altitudeMinM: acc.altitudeMinM,
    altitudeMaxM: acc.altitudeMaxM,
    altitudeSamples: acc.altitudeSamples,
    terrainImpactPct: impact,
    flatKmPerL: flatEquivalentKmPerL(kmPerL, impact),
    roadSmoothCount: acc.roadSmoothCount,
    roadRoughCount: acc.roadRoughCount,
    roadBumpyCount: acc.roadBumpyCount,
    roadSamples: acc.roadSamples,
    roadSmoothPct: roadSharePct(acc.roadSmoothCount, acc.roadSamples),
    roadRoughPct: roadSharePct(acc.roadRoughCount, acc.roadSamples),
    roadBumpyPct: roadSharePct(acc.roadBumpyCount, acc.roadSamples),
    avgVibrationMg: acc.roadSamples > 0 ? acc.vibrationWeighted / acc.roadSamples : 0,
    maxVibrationMg: acc.maxVibrationMg,
  };
}

export type MetricsTotals = ReturnType<typeof sumMetrics>;

export function movingSharePct(activeHours: number, idleHours: number): number {
  const engine = activeHours + idleHours;
  return engine > 0 ? (activeHours / engine) * 100 : 0;
}

export function describeFuelSource(rows: PeriodMetrics[]): string {
  const sources = new Set(rows.map((row) => row.fuelSource).filter((s) => s !== "none"));
  if (sources.size === 0) return "no fuel sensor in this range";
  if (sources.has("can") && sources.has("tank")) {
    return "cost uses CAN where it moves, otherwise tank";
  }
  if (sources.has("can")) return "cost uses CAN consumed counter";
  return "cost uses tank (start − end + refills)";
}
