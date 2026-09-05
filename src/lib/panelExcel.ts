import { comparePeriods, compareSnapshots, type CompareMetric } from "./compare";
import { RANK_COLUMNS, alignedPeriodKeys, totalsToCompare, type FleetVehicleRow } from "./fleet";
import { formatRpm, formatSpeed } from "./format";
import type { InsightBlock } from "./insight";
import { movingSharePct, type MetricsTotals } from "./metrics";
import type { ArmadaEvent, CustomField } from "./api";
import { countEventsInRange, eventsInRange } from "./api";
import { addressAt } from "./reverseGeocode";
import {
  googleMapsUrl,
  timelineSlicesForDay,
  type TripSegment,
} from "./tripSegments";
import { eachDateInclusive, offsetToMinutes } from "./time";
import type { PeriodMetrics } from "./types";
import type { ExcelCell } from "./xlsxDownload";
import { pairsToSheet } from "./xlsxDownload";

function n(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function formatWhen(ms: number, offset: string): string {
  const shifted = new Date(ms + offsetToMinutes(offset) * 60_000);
  const iso = shifted.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function compareMetricRows(metrics: CompareMetric[], colA: string, colB: string): ExcelCell[][] {
  return [
    ["Metric", colA, colB, "Delta %"],
    ...metrics.map((m) => [
      m.label,
      n(m.a, 3),
      n(m.b, 3),
      m.pct === null ? "" : n(m.pct, 2),
    ]),
  ];
}

export function vehicleKpiSheet(totals: MetricsTotals): ExcelCell[][] {
  return pairsToSheet([
    ["GPS distance km", n(totals.gps)],
    ["Ignition distance km", n(totals.ignition)],
    ["Odometer km", n(totals.odometer)],
    ["Active hours", n(totals.hours, 3)],
    ["Idle hours", n(totals.idle, 3)],
    ["Moving share %", n(movingSharePct(totals.hours, totals.idle), 1)],
    ["Trips", totals.trips],
    ["Fuel L", n(totals.fuel)],
    ["CAN fuel L", n(totals.canFuel)],
    ["Tank fuel L", n(totals.tankFuel)],
    ["Refill L", n(totals.refill)],
    ["Fuel cost", n(totals.cost, 0)],
    ["Avg speed km/h", n(totals.avgSpeed, 1)],
    ["Max speed km/h", n(totals.maxSpeed, 1)],
    ["Avg RPM", n(totals.avgRpm, 0)],
    ["Max RPM", n(totals.maxRpm, 0)],
  ]);
}

export function periodDistanceSheet(rows: PeriodMetrics[]): ExcelCell[][] {
  return [
    ["Period", "GPS all km", "Ignition km", "Odometer km", "Active hours"],
    ...rows.map((row) => [
      row.label,
      n(row.gpsDistanceKm),
      n(row.ignitionDistanceKm),
      n(row.odometerKm),
      n(row.activeHours, 3),
    ]),
  ];
}

export function periodSpeedRpmSheet(rows: PeriodMetrics[]): ExcelCell[][] {
  return [
    ["Period", "Avg speed km/h", "Max speed km/h", "Avg RPM", "Max RPM"],
    ...rows.map((row) => [
      row.label,
      n(row.avgSpeedKmh, 1),
      n(row.maxSpeedKmh, 1),
      n(row.avgRpm, 0),
      n(row.maxRpm, 0),
    ]),
  ];
}

export function periodUtilizationSheet(rows: PeriodMetrics[]): ExcelCell[][] {
  return [
    ["Period", "Active hours", "Idle hours", "Moving share %"],
    ...rows.map((row) => [
      row.label,
      n(row.activeHours, 3),
      n(row.idleHours, 3),
      n(movingSharePct(row.activeHours, row.idleHours), 1),
    ]),
  ];
}

export function periodFuelSheet(rows: PeriodMetrics[]): ExcelCell[][] {
  return [
    ["Period", "Used L", "CAN L", "Tank L", "Refill L", "Cost", "km/l"],
    ...rows.map((row) => [
      row.label,
      n(row.fuelUsedL),
      n(row.canFuelUsedL),
      n(row.tankFuelUsedL),
      n(row.refillL),
      n(row.fuelCost, 0),
      n(row.kmPerL, 2),
    ]),
  ];
}

export function periodTerrainSheet(rows: PeriodMetrics[]): ExcelCell[][] {
  return [
    ["Period", "Gain m", "Loss m", "Min alt", "Max alt", "Impact %", "km/l", "Flat km/l"],
    ...rows.map((row) => [
      row.label,
      n(row.elevationGainM, 0),
      n(row.elevationLossM, 0),
      row.altitudeMinM === null ? "" : n(row.altitudeMinM, 0),
      row.altitudeMaxM === null ? "" : n(row.altitudeMaxM, 0),
      n(row.terrainImpactPct, 1),
      n(row.kmPerL, 2),
      n(row.flatKmPerL, 2),
    ]),
  ];
}

export function periodRoadSheet(rows: PeriodMetrics[]): ExcelCell[][] {
  return [
    ["Period", "Smooth %", "Rough %", "Bumpy %", "Avg vibration mg", "Max vibration mg", "Samples"],
    ...rows.map((row) => [
      row.label,
      n(row.roadSmoothPct, 1),
      n(row.roadRoughPct, 1),
      n(row.roadBumpyPct, 1),
      n(row.avgVibrationMg, 0),
      n(row.maxVibrationMg, 0),
      row.roadSamples,
    ]),
  ];
}

export function periodDetailSheet(rows: PeriodMetrics[]): ExcelCell[][] {
  return [
    [
      "Period",
      "Trips",
      "GPS all km",
      "Ignition km",
      "Odometer km",
      "Active h",
      "Idle h",
      "Avg km/h",
      "Max km/h",
      "Avg RPM",
      "Max RPM",
      "Fuel L",
      "CAN L",
      "Tank L",
      "Refill L",
      "km/l",
      "Gain m",
      "Loss m",
      "Flat km/l",
    ],
    ...rows.map((row) => [
      row.label,
      row.tripCount,
      n(row.gpsDistanceKm),
      n(row.ignitionDistanceKm),
      n(row.odometerKm),
      n(row.activeHours, 3),
      n(row.idleHours, 3),
      n(row.avgSpeedKmh, 1),
      n(row.maxSpeedKmh, 1),
      n(row.avgRpm, 0),
      n(row.maxRpm, 0),
      n(row.fuelUsedL),
      n(row.canFuelUsedL),
      n(row.tankFuelUsedL),
      n(row.refillL),
      n(row.kmPerL, 2),
      n(row.elevationGainM, 0),
      n(row.elevationLossM, 0),
      n(row.flatKmPerL, 2),
    ]),
  ];
}

export function periodCompareSheet(
  rows: PeriodMetrics[],
  baselineKey: string,
  compareKey: string,
): ExcelCell[][] {
  const baseline = rows.find((row) => row.key === baselineKey);
  const compare = rows.find((row) => row.key === compareKey);
  if (!baseline || !compare) return [["Metric", "First", "Second", "Delta %"]];
  return compareMetricRows(comparePeriods(baseline, compare), baseline.label, compare.label);
}

export function insightsSheet(insights: InsightBlock[]): ExcelCell[][] {
  return [["Title", "Body"], ...insights.map((block) => [block.title, block.body])];
}

export function fleetRankSheet(vehicles: FleetVehicleRow[]): ExcelCell[][] {
  return [
    ["Vehicle", ...RANK_COLUMNS.map((c) => c.label)],
    ...vehicles.map((row) => [row.label, ...RANK_COLUMNS.map((c) => n(c.value(row), 3))]),
  ];
}

export function behaviorEventsSheet(
  periods: Array<{
    label: string;
    harshBraking: number;
    harshAcceleration: number;
    harshCornering: number;
    overspeed: number;
  }>,
): ExcelCell[][] {
  return [
    ["Period", "Harsh braking", "Harsh acceleration", "Harsh cornering", "Overspeed"],
    ...periods.map((row) => [
      row.label,
      row.harshBraking,
      row.harshAcceleration,
      row.harshCornering,
      row.overspeed,
    ]),
  ];
}

export function fleetDistanceByVehicleSheet(vehicles: FleetVehicleRow[]): ExcelCell[][] {
  return [
    ["Vehicle", "GPS km"],
    ...vehicles.map((v) => [v.label, n(v.totals.gps)]),
  ];
}

export function fleetDistanceOverTimeSheet(vehicles: FleetVehicleRow[]): ExcelCell[][] {
  const keys = alignedPeriodKeys(vehicles);
  return [
    ["Period", ...vehicles.map((v) => v.label)],
    ...keys.map(({ key, label }) => [
      label,
      ...vehicles.map((v) => {
        const row = v.rows.find((r) => r.key === key);
        return row ? n(row.gpsDistanceKm) : 0;
      }),
    ]),
  ];
}

export function fleetUtilizationSheet(vehicles: FleetVehicleRow[]): ExcelCell[][] {
  return [
    ["Vehicle", "Active h", "Idle h", "Moving share %"],
    ...vehicles.map((v) => [
      v.label,
      n(v.totals.hours, 3),
      n(v.totals.idle, 3),
      n(movingSharePct(v.totals.hours, v.totals.idle), 1),
    ]),
  ];
}

export function fleetEfficiencySheet(vehicles: FleetVehicleRow[]): ExcelCell[][] {
  return [
    ["Vehicle", "km/l"],
    ...vehicles.map((v) => [v.label, n(v.totals.fuel > 0 ? v.totals.gps / v.totals.fuel : 0, 2)]),
  ];
}

export function fleetFuelSheet(vehicles: FleetVehicleRow[]): ExcelCell[][] {
  return [
    ["Vehicle", "CAN L", "Tank L", "Fuel L", "Cost"],
    ...vehicles.map((v) => [
      v.label,
      n(v.totals.canFuel),
      n(v.totals.tankFuel),
      n(v.totals.fuel),
      n(v.totals.cost, 0),
    ]),
  ];
}

export function fleetSafetySheet(vehicles: FleetVehicleRow[]): ExcelCell[][] {
  return [
    ["Vehicle", "Braking", "Acceleration", "Cornering", "Overspeed", "Safety score", "Events/100 km"],
    ...vehicles.map((v) => [
      v.label,
      v.behavior?.harshBraking ?? 0,
      v.behavior?.harshAcceleration ?? 0,
      v.behavior?.harshCornering ?? 0,
      v.behavior?.overspeed ?? 0,
      n(v.behavior?.safetyScore ?? 0, 0),
      n(v.behavior?.eventsPer100km ?? 0, 2),
    ]),
  ];
}

export function fleetHeadToHeadSheet(
  vehicles: FleetVehicleRow[],
  baselineId: number,
  compareId: number,
): ExcelCell[][] {
  const a = vehicles.find((v) => v.userId === baselineId);
  const b = vehicles.find((v) => v.userId === compareId);
  if (!a || !b) return [["Metric", "A", "B", "Delta %"]];
  return compareMetricRows(
    compareSnapshots(totalsToCompare(a.totals), totalsToCompare(b.totals)),
    a.label,
    b.label,
  );
}

export function fleetKpiSheet(options: {
  vehicleCount: number;
  gpsKm: number;
  activeHours: number;
  idleHours: number;
  fuelL: number;
  cost: number;
}): ExcelCell[][] {
  const kmPerL = options.fuelL > 0 ? options.gpsKm / options.fuelL : 0;
  return pairsToSheet([
    ["Vehicles", options.vehicleCount],
    ["Fleet GPS km", n(options.gpsKm)],
    ["Active hours", n(options.activeHours, 3)],
    ["Moving share %", n(movingSharePct(options.activeHours, options.idleHours), 1)],
    ["Fleet fuel L", n(options.fuelL)],
    ["km/l", n(kmPerL, 2)],
    ["Cost", n(options.cost, 0)],
  ]);
}

export function tripSummarySheet(options: {
  trips: number;
  distanceKm: number;
  movingHours: number;
  idleStopHours: number;
  fuelL: number;
  events: number;
  recordedHours: number;
  dayCount: number;
}): ExcelCell[][] {
  return pairsToSheet([
    ["Trips", options.trips],
    ["Distance km", n(options.distanceKm)],
    ["Moving hours", n(options.movingHours, 3)],
    ["Idle / Stop hours", n(options.idleStopHours, 3)],
    ["Fuel L", n(options.fuelL)],
    ["Events", options.events],
    ["Recorded hours", n(options.recordedHours, 3)],
    ["Days", options.dayCount],
  ]);
}

export function tripTimelineSheet(
  segments: TripSegment[],
  dateFrom: string,
  dateTo: string,
  timezone: string,
): ExcelCell[][] {
  const days = eachDateInclusive(dateFrom, dateTo);
  const out: ExcelCell[][] = [["Day", "Status", "Start % of day", "Width % of day", "Segment id"]];
  for (const day of days) {
    for (const slice of timelineSlicesForDay(segments, day, timezone)) {
      out.push([day, slice.status, n(slice.leftPct, 2), n(slice.widthPct, 2), slice.segmentId]);
    }
  }
  return out;
}

export function tripSegmentsSheet(options: {
  segments: TripSegment[];
  events: ArmadaEvent[];
  customFields: CustomField[];
  customFieldNames: string[];
  vehicleName: string;
  groupName: string;
  timezone: string;
  includeRpm: boolean;
  includeRefill: boolean;
  includeEvents: boolean;
  addresses?: Record<string, string>;
}): ExcelCell[][] {
  const {
    segments,
    events,
    customFields,
    customFieldNames,
    vehicleName,
    groupName,
    timezone,
    includeRpm,
    includeRefill,
    includeEvents,
    addresses = {},
  } = options;
  const selectedCf = customFields.filter((cf) => customFieldNames.includes(cf.name));
  const headers: string[] = [
    "Vehicle Name",
    "Group",
    ...selectedCf.map((cf) => cf.name),
    "Trip Status",
    "Start Time",
    "End Time",
    "Duration",
    "Start Lat",
    "Start Lon",
    "Start Location",
    "Start Map",
    "End Lat",
    "End Lon",
    "End Location",
    "End Map",
    "Distance km",
    "Speed Avg",
    "Speed Max",
  ];
  if (includeRpm) headers.push("RPM Avg", "RPM Max");
  headers.push("Fuel L", "Fuel source");
  if (includeRefill) headers.push("Refill L");
  if (includeEvents) headers.push("Event Count", "Event rules");

  const body = segments.map((seg) => {
    const eventCount = countEventsInRange(events, seg.startMs, seg.endMs);
    const rules = eventsInRange(events, seg.startMs, seg.endMs)
      .map((e) => e.ruleName || `Rule ${e.ruleId}`)
      .join("; ");
    const row: ExcelCell[] = [
      vehicleName,
      groupName,
      ...selectedCf.map((cf) => cf.value || ""),
      seg.status,
      formatWhen(seg.startMs, timezone),
      formatWhen(seg.endMs, timezone),
      formatDuration(seg.durationMs),
      seg.startLat ?? "",
      seg.startLon ?? "",
      addressAt(addresses, seg.startLat, seg.startLon),
      seg.startLat !== null && seg.startLon !== null ? googleMapsUrl(seg.startLat, seg.startLon) : "",
      seg.endLat ?? "",
      seg.endLon ?? "",
      addressAt(addresses, seg.endLat, seg.endLon),
      seg.endLat !== null && seg.endLon !== null ? googleMapsUrl(seg.endLat, seg.endLon) : "",
      seg.status === "trip" ? n(seg.distanceKm) : "",
      seg.status === "trip" ? formatSpeed(seg.avgSpeedKmh) : "",
      seg.status === "trip" ? formatSpeed(seg.maxSpeedKmh) : "",
    ];
    if (includeRpm) {
      row.push(seg.avgRpm > 0 ? formatRpm(seg.avgRpm) : "", seg.maxRpm > 0 ? formatRpm(seg.maxRpm) : "");
    }
    row.push(seg.fuelUsedL > 0 ? n(seg.fuelUsedL) : "", seg.fuelSource);
    if (includeRefill) row.push(seg.refillL > 0 ? n(seg.refillL) : "");
    if (includeEvents) row.push(eventCount || "", rules);
    return row;
  });

  return [headers, ...body];
}

export function compactSnapshotSheet(totals: MetricsTotals, extras: Array<[string, ExcelCell]>): ExcelCell[][] {
  return pairsToSheet([
    ["Avg speed km/h", n(totals.avgSpeed, 1)],
    ["Max speed km/h", n(totals.maxSpeed, 1)],
    ["Avg RPM", n(totals.avgRpm, 0)],
    ["Max RPM", n(totals.maxRpm, 0)],
    ["CAN L", n(totals.canFuel)],
    ["Tank L", n(totals.tankFuel)],
    ...extras,
  ]);
}