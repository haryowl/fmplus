import { describe, expect, it } from "vitest";
import {
  derivedStaleExceptions,
  exceptionGeofenceName,
  exceptionUserId,
  filterExceptionsByGroup,
  type ExceptionItem,
} from "./exceptions";
import type { LastStatusRow } from "./lastStatus";
import { STALE_MS } from "./liveOps";

function row(partial: Partial<LastStatusRow> & Pick<LastStatusRow, "id">): LastStatusRow {
  return {
    name: `V${partial.id}`,
    username: `u${partial.id}`,
    utc: "",
    deviceActivity: "",
    lastMs: null,
    lat: -6,
    lon: 106,
    altitude: null,
    heading: null,
    speedKmh: 0,
    ignition: false,
    fuelLevel: null,
    odometerKm: null,
    ...partial,
  };
}

function notify(partial: Partial<ExceptionItem> & Pick<ExceptionItem, "id">): ExceptionItem {
  return {
    kind: "exception",
    ruleName: "Speeding",
    eventTime: null,
    armadaUsername: "",
    userDisplayName: "",
    lat: null,
    lon: null,
    payload: {},
    createdAt: "2026-09-06T06:00:00Z",
    ackedAt: null,
    ackedNote: "",
    source: "notify",
    ...partial,
  };
}

describe("derivedStaleExceptions", () => {
  const now = Date.parse("2026-09-06T06:00:00Z");

  it("returns only vehicles older than STALE_MS", () => {
    const rows = [
      row({ id: 1, lastMs: now - STALE_MS - 1 }),
      row({ id: 2, lastMs: now - 1000 }),
    ];
    const out = derivedStaleExceptions(rows, now);
    expect(out.map((x) => x.userId)).toEqual([1]);
  });
});

describe("filterExceptionsByGroup", () => {
  it("keeps rows matching user id or username", () => {
    const items = [
      notify({ id: "a", payload: { USER_ID: 10 }, armadaUsername: "truck-a" }),
      notify({ id: "b", armadaUsername: "truck-b" }),
      notify({ id: "c", payload: { USER_ID: 99 }, armadaUsername: "other" }),
    ];
    const out = filterExceptionsByGroup(items, { userIds: [10], usernames: ["truck-b"] });
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("resolves user id from payload", () => {
    expect(exceptionUserId(notify({ id: "x", payload: { USER_ID: "42" } }))).toBe(42);
  });
});

describe("exceptionGeofenceName", () => {
  it("reads GEOFENCE_NAME from payload", () => {
    expect(
      exceptionGeofenceName(notify({ id: "g", payload: { GEOFENCE_NAME: "Depot A" } })),
    ).toBe("Depot A");
  });

  it("falls back to fence-like rule names", () => {
    expect(exceptionGeofenceName(notify({ id: "g", ruleName: "Geofence Exit West" }))).toBe(
      "Geofence Exit West",
    );
    expect(exceptionGeofenceName(notify({ id: "g", ruleName: "Speeding" }))).toBe("");
  });
});
