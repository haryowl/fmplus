/**
 * Resolve profile + cargo fields from a dispatch order CSV row.
 * Shared by POST /api/dispatch/orders/import (and unit tests).
 */
import { passengerDemandToCargo } from "./dispatch-fare.mjs";
import { parseOrderKind } from "./dispatch-pickup-drop.mjs";
import { parseOrderProfile } from "./dispatch-sales.mjs";
import { csvNum } from "./csv-parse.mjs";

function intOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {"cargo"|"passenger"|"sales"}
 */
export function resolveOrderCsvProfile(row) {
  const explicit = parseOrderProfile(row.profile || row.order_profile || row.orderProfile);
  if (explicit) return explicit;
  const pax = csvNum(row.passenger_count ?? row.passengerCount);
  const lug = csvNum(row.luggage_kg ?? row.luggageKg);
  if (pax != null || lug != null) return "passenger";
  return "cargo";
}

/**
 * @param {Record<string, unknown>} row
 * @param {"cargo"|"passenger"|"sales"} [profile]
 */
export function cargoFromOrderCsvRow(row, profile = resolveOrderCsvProfile(row)) {
  if (profile === "sales") {
    return {
      volumeM3: null,
      weightKg: null,
      passengerCount: null,
      luggageKg: null,
    };
  }
  if (profile === "passenger") {
    const mapped = passengerDemandToCargo({
      passengerCount: row.passenger_count ?? row.passengerCount ?? 1,
      luggageKg: row.luggage_kg ?? row.luggageKg,
    });
    return {
      volumeM3: mapped.volumeM3,
      weightKg: mapped.weightKg,
      passengerCount: mapped.passengerCount,
      luggageKg: mapped.luggageKg,
    };
  }
  return {
    volumeM3: csvNum(row.volume_m3 ?? row.volumeM3),
    weightKg: csvNum(row.weight_kg ?? row.weightKg),
    passengerCount: intOrNull(row.passenger_count ?? row.passengerCount),
    luggageKg: csvNum(row.luggage_kg ?? row.luggageKg),
  };
}

/** Whether goods/SKU lines should be attached (cargo only). */
export function orderCsvAllowsGoodsLines(profile) {
  return profile === "cargo";
}

/**
 * Optional pickup_drop fields from CSV.
 * @returns {{ kind: string, pickupAddress: string|null, pickupLat: number|null, pickupLon: number|null, pickupZone: string|null, error?: string }}
 */
export function pickupFromOrderCsvRow(row) {
  const kind = parseOrderKind(row.kind);
  const pickupAddress = String(row.pickup_address || row.pickupAddress || "")
    .trim()
    .slice(0, 500) || null;
  const pickupLat = csvNum(row.pickup_lat ?? row.pickupLat);
  const pickupLon = csvNum(row.pickup_lon ?? row.pickupLon ?? row.pickupLng);
  const pickupZone = String(row.pickup_zone || row.pickupZone || "")
    .trim()
    .slice(0, 80) || null;
  if (kind === "pickup_drop") {
    if (
      pickupLat == null ||
      pickupLon == null ||
      Math.abs(pickupLat) > 90 ||
      Math.abs(pickupLon) > 180
    ) {
      return {
        kind,
        pickupAddress,
        pickupLat,
        pickupLon,
        pickupZone,
        error: "pickup_drop rows require pickup_lat and pickup_lon",
      };
    }
  }
  return { kind, pickupAddress, pickupLat, pickupLon, pickupZone };
}
