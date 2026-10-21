import { describe, expect, it } from "vitest";
import { placesAccessRows, type PlacesSummary } from "./places";

function summary(partial: Partial<PlacesSummary["armada"]>): PlacesSummary {
  return {
    days: 30,
    geofenceGroups: [],
    geofences: [],
    fenceHits: [],
    recentFenceEvents: [],
    reports: [],
    armada: {
      geofenceGroups: { ok: false, status: 403, error: "Forbidden", count: 0 },
      geofences: { ok: false, status: 403, error: "Forbidden", count: 0 },
      pois: { ok: false, status: 403, error: "denied", available: false },
      reports: { ok: true, status: 200, count: 7, templates: 0 },
      ...partial,
    },
  };
}

describe("placesAccessRows", () => {
  it("marks catalog denials and report success", () => {
    const rows = placesAccessRows(summary({}));
    expect(rows.find((r) => r.label === "Reports")?.ok).toBe(true);
    expect(rows.find((r) => r.label === "Geofences")?.ok).toBe(false);
    expect(rows.find((r) => r.label === "POI categories")?.ok).toBe(false);
  });

  it("treats skipped Armada catalogs as unused, not denied", () => {
    const skipped = { ok: true, skipped: true, status: 0, error: null, count: 0, available: false };
    const rows = placesAccessRows(
      summary({
        geofenceGroups: skipped,
        geofences: skipped,
        pois: skipped,
        reports: skipped,
      }),
    );
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(rows.find((r) => r.label === "Geofences")?.detail).toMatch(/not used/i);
  });
});
