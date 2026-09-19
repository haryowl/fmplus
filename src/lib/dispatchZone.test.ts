import { describe, expect, it } from "vitest";
import {
  normalizeZoneKey,
  partitionOrdersToDepots,
  routeDominantZone,
  zoneMixPenalty,
  ZONE_MIX_PENALTY_KM,
} from "../../server/dispatch-zone.mjs";

function hv(a, b, c, d) {
  // Cheap stub: Manhattan-ish on lat only for tests.
  return Math.abs(a - c) + Math.abs(b - d);
}

describe("normalizeZoneKey", () => {
  it("folds case and spaces", () => {
    expect(normalizeZoneKey("  Dago ")).toBe("dago");
    expect(normalizeZoneKey("Bandung  Utara")).toBe("bandung utara");
  });

  it("treats blank as empty", () => {
    expect(normalizeZoneKey("")).toBe("");
    expect(normalizeZoneKey(null)).toBe("");
  });
});

describe("partitionOrdersToDepots", () => {
  const depots = [
    { id: "north", lat: -6.1, lon: 106.8 },
    { id: "south", lat: -6.3, lon: 106.8 },
  ];
  const orders = [
    { lat: -6.11, lon: 106.8, zone: "Dago" },
    { lat: -6.29, lon: 106.8, zone: "" },
    { lat: -6.12, lon: 106.8, zone: "Serpong" },
  ];

  it("defaults to nearest depot when prefer is off", () => {
    const clusters = partitionOrdersToDepots(orders, depots, { preferZoneDepot: false }, hv);
    expect(clusters.get("north")).toEqual([0, 2]);
    expect(clusters.get("south")).toEqual([1]);
  });

  it("uses zone map when prefer is on, else nearest", () => {
    const clusters = partitionOrdersToDepots(
      orders,
      depots,
      {
        preferZoneDepot: true,
        zoneDepotMap: { dago: "south", serpong: "north" },
      },
      hv,
    );
    // Dago → south even though nearer north; blank → nearest south; Serpong → north
    expect(clusters.get("south")).toEqual([0, 1]);
    expect(clusters.get("north")).toEqual([2]);
  });

  it("ignores mapped depot ids that are not in the depot list", () => {
    const clusters = partitionOrdersToDepots(
      orders,
      depots,
      { preferZoneDepot: true, zoneDepotMap: { dago: "missing" } },
      hv,
    );
    expect(clusters.get("north")).toContain(0);
  });
});

describe("zoneMixPenalty", () => {
  const orders = [{ zone: "Dago" }, { zone: "Dago" }, { zone: "Lembang" }, { zone: "" }];

  it("is zero when prefer is off", () => {
    expect(zoneMixPenalty(false, [0], orders, 2)).toBe(0);
  });

  it("is zero when route has no zone yet or candidate has none", () => {
    expect(zoneMixPenalty(true, [], orders, 2)).toBe(0);
    expect(zoneMixPenalty(true, [0], orders, 3)).toBe(0);
  });

  it("penalises mixing a different zone onto a zoned route", () => {
    expect(zoneMixPenalty(true, [0, 1], orders, 2)).toBe(ZONE_MIX_PENALTY_KM);
    expect(zoneMixPenalty(true, [0, 1], orders, 0)).toBe(0);
  });

  it("picks the dominant route zone", () => {
    expect(routeDominantZone([0, 1, 2], orders)).toBe("dago");
  });
});
