import { describe, expect, it } from "vitest";
import {
  derivedStaleExceptions,
  exceptionGeofenceName,
  exceptionSourceLabel,
  exceptionTrackerDeviceId,
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

  it("attaches trackerDeviceId from the row map", () => {
    const rows = [row({ id: -9, lastMs: now - STALE_MS - 1 })];
    const map = new Map<number, string>([[-9, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]]);
    const out = derivedStaleExceptions(rows, now, map);
    expect(out[0]?.trackerDeviceId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
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

  it("keeps notifier rows matching device id", () => {
    const items = [
      notify({
        id: "n1",
        trackerDeviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
      notify({ id: "n2", payload: { DEVICE_ID: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff" } }),
    ];
    const out = filterExceptionsByGroup(items, {
      deviceIds: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    });
    expect(out.map((x) => x.id)).toEqual(["n1"]);
  });

  it("keeps derived rows matching device id", () => {
    const items = [
      notify({
        id: "d1",
        source: "derived",
        userId: -3,
        trackerDeviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
      notify({ id: "d2", source: "derived", userId: -4, trackerDeviceId: "other" }),
    ];
    const out = filterExceptionsByGroup(items, {
      deviceIds: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    });
    expect(out.map((x) => x.id)).toEqual(["d1"]);
  });

  it("resolves user id from payload", () => {
    expect(exceptionUserId(notify({ id: "x", payload: { USER_ID: "42" } }))).toBe(42);
  });
});

describe("exceptionTrackerDeviceId", () => {
  it("prefers the row field, then payload UUID", () => {
    expect(
      exceptionTrackerDeviceId(
        notify({
          id: "t1",
          trackerDeviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        }),
      ),
    ).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(
      exceptionTrackerDeviceId(
        notify({
          id: "t2",
          payload: { DEVICE_ID: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff" },
        }),
      ),
    ).toBe("bbbbbbbb-cccc-dddd-eeee-ffffffffffff");
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

describe("exceptionSourceLabel", () => {
  it("labels notifier, fleet, and derived rows", () => {
    expect(exceptionSourceLabel(notify({ id: "n" }))).toBe("Notifier");
    expect(exceptionSourceLabel(notify({ id: "f", source: "fleet" }))).toBe("Fleet Live");
    expect(exceptionSourceLabel(notify({ id: "d", source: "derived" }))).toBe("Derived");
  });
});

describe("fleet inbox rows", () => {
  it("keeps Fleet Live alerts matching device id", () => {
    const items = [
      notify({
        id: "f1",
        source: "fleet",
        trackerDeviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
      notify({ id: "f2", source: "fleet", trackerDeviceId: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff" }),
    ];
    const out = filterExceptionsByGroup(items, {
      deviceIds: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    });
    expect(out.map((x) => x.id)).toEqual(["f1"]);
  });
});
