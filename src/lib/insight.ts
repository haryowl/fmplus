import type { BehaviorSummary } from "./behavior";
import { formatHours, formatKm, formatKmPerL, formatLiters, formatMeters, formatPct, formatSpeed } from "./format";

export type InsightDepth = "standard" | "detailed";

export type InsightBlock = {
  id: string;
  title: string;
  body: string;
};

export type InsightInput = {
  gpsKm: number;
  activeHours: number;
  idleHours: number;
  avgSpeedKmh: number;
  avgRpm: number;
  maxRpm: number;
  fuelUsedL: number;
  canFuelUsedL: number;
  tankFuelUsedL: number;
  kmPerL: number;
  flatKmPerL: number;
  terrainImpactPct: number;
  elevationGainM: number;
  elevationLossM: number;
  altitudeSamples: number;
  roadSamples: number;
  roadSmoothPct: number;
  roadRoughPct: number;
  roadBumpyPct: number;
  avgVibrationMg: number;
  behavior: BehaviorSummary | null;
};

function fuelSentence(input: InsightInput): string {
  if (input.kmPerL <= 0) return "Not enough fuel data for an efficiency reading.";
  let text = `Current efficiency ${formatKmPerL(input.kmPerL)} km/l from ${formatLiters(input.fuelUsedL)} L used over ${formatKm(input.gpsKm)} km.`;
  if (input.canFuelUsedL > 0 && input.tankFuelUsedL > 0) {
    text += ` CAN reports ${formatLiters(input.canFuelUsedL)} L; tank identity ${formatLiters(input.tankFuelUsedL)} L.`;
    const gap = Math.abs(input.canFuelUsedL - input.tankFuelUsedL);
    const basis = Math.max(input.canFuelUsedL, input.tankFuelUsedL);
    if (basis > 0 && gap / basis > 0.2) {
      text += " The two sensors disagree by more than 20% — treat tank as a check, not the cost figure.";
    }
  }
  if (input.altitudeSamples > 0 && input.elevationGainM > 0 && input.terrainImpactPct > 0) {
    text += ` Terrain impact about ${formatPct(input.terrainImpactPct)} extra fuel from ${formatMeters(input.elevationGainM)} gain.`;
    if (input.flatKmPerL > input.kmPerL) {
      text += ` Flat-terrain equivalent ${formatKmPerL(input.flatKmPerL)} km/l.`;
    }
  }
  return text;
}

function performanceSentence(input: InsightInput, depth: InsightDepth): string {
  let text = `Average speed ${formatSpeed(input.avgSpeedKmh)} km/h over ${formatKm(input.gpsKm)} km in ${formatHours(input.activeHours)} active hours.`;
  if (depth === "detailed") {
    const engine = input.activeHours + input.idleHours;
    if (engine > 0) {
      const idleShare = (input.idleHours / engine) * 100;
      text += ` Idle ${formatHours(input.idleHours)} h (${formatPct(idleShare)} of engine-on time).`;
    }
    if (input.avgRpm > 0) {
      text += ` Average RPM ${Math.round(input.avgRpm).toLocaleString("en-US")}, max ${Math.round(input.maxRpm).toLocaleString("en-US")}.`;
    }
  }
  return text;
}

function behaviorSentence(input: InsightInput, depth: InsightDepth): string {
  const b = input.behavior;
  if (!b || b.totalEvents === 0) {
    let text = "Good driving behavior with no significant events detected.";
    if (input.altitudeSamples > 0 && (input.elevationGainM > 0 || input.elevationLossM > 0)) {
      text += ` Drive included ${formatMeters(input.elevationGainM)} gain and ${formatMeters(input.elevationLossM)} loss.`;
    }
    return text;
  }
  let text = `${b.totalEvents} events (${b.eventsPer100km.toFixed(2)} / 100 km). Safety score ${b.safetyScore.toFixed(0)}/100.`;
  if (b.topIssue) text += ` Most frequent: ${b.topIssue.toLowerCase()}.`;
  if (depth === "detailed" && input.altitudeSamples > 0) {
    const uphill = b.harshAcceleration + b.overspeed;
    const downhill = b.harshBraking + b.harshCornering;
    if (input.elevationGainM > 0 || input.elevationLossM > 0) {
      text += ` ${uphill} accel/overspeed events with the climbs; ${downhill} brake/corner events with the descents.`;
    }
  }
  return text;
}

function roadSentence(input: InsightInput): string | null {
  if (input.roadSamples === 0) return null;
  return `Road surface ${formatPct(input.roadSmoothPct)} smooth, ${formatPct(input.roadRoughPct)} rough, ${formatPct(input.roadBumpyPct)} bumpy. Average vibration ${Math.round(input.avgVibrationMg)} mG.`;
}

function maintenanceItems(input: InsightInput, depth: InsightDepth): string[] {
  const items: string[] = [];
  if (input.kmPerL > 0 && input.kmPerL < 10) {
    items.push("Fuel system inspection recommended.");
  } else if (input.kmPerL >= 10 && input.kmPerL < 12) {
    items.push("Monitor fuel efficiency.");
  }
  if (input.maxRpm > 4000) {
    items.push("High RPM usage — consider an engine check.");
    if (input.elevationGainM > 500) {
      items.push("High elevation gain adds engine load.");
    }
  }
  if (input.elevationLossM > 1000) {
    items.push("Brake system inspection after significant elevation loss.");
  }
  if (input.roadBumpyPct > 15) {
    items.push("Elevated bumpy share — check suspension and tyre condition.");
  }
  const adjustedKm = input.gpsKm * (1 + input.elevationGainM / 10000);
  if (adjustedKm > 5000) {
    items.push("Elevation-adjusted distance is due for scheduled maintenance.");
  } else if (adjustedKm > 3000) {
    items.push("Elevation-adjusted distance is approaching a service interval.");
  }
  if (items.length === 0) items.push("No urgent maintenance flagged from this range.");
  if (depth === "detailed") {
    items.push(
      `Based on ${formatKm(input.gpsKm)} km, ${formatMeters(input.elevationGainM)} gain, ${formatMeters(input.elevationLossM)} loss.`,
    );
  }
  return items;
}

export function buildInsights(input: InsightInput, depth: InsightDepth): InsightBlock[] {
  const blocks: InsightBlock[] = [
    { id: "performance", title: "Performance", body: performanceSentence(input, depth) },
    { id: "efficiency", title: "Fuel efficiency", body: fuelSentence(input) },
    { id: "behavior", title: "Driving behavior", body: behaviorSentence(input, depth) },
  ];
  const road = roadSentence(input);
  if (road) blocks.push({ id: "road", title: "Road condition", body: road });
  blocks.push({
    id: "maintenance",
    title: "Maintenance",
    body: maintenanceItems(input, depth).join(" "),
  });
  return blocks;
}
