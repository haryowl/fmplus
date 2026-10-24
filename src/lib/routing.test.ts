import { describe, expect, it } from "vitest";
import {
  compactHref,
  fleetCompactHref,
  fleetHref,
  fleetLiveHref,
  fullHref,
  isCompactPath,
  statusHref,
  tripsHref,
  liveHref,
  exceptionsHref,
  maintenanceHref,
  placesHref,
  routePlanHref,
  jobsHref,
  goodsHref,
  customersHref,
  dispatchLiveHref,
  vehicleTrackHref,
  armadaTripViewRedirectHref,
  viewFromPath,
  withSearch,
} from "./routing";

describe("viewFromPath", () => {
  it("routes fleet compact separately from single-vehicle compact", () => {
    expect(viewFromPath("/compact")).toBe("compact");
    expect(viewFromPath("/compact/")).toBe("compact");
    expect(viewFromPath("/fleet")).toBe("fleet");
    expect(viewFromPath("/fleet/compact")).toBe("fleetCompact");
    expect(viewFromPath("/fleet/compact/")).toBe("fleetCompact");
    expect(viewFromPath("/status")).toBe("status");
    expect(viewFromPath("/status/")).toBe("status");
    expect(viewFromPath("/trips")).toBe("trips");
    expect(viewFromPath("/trips/")).toBe("trips");
    expect(viewFromPath("/live")).toBe("live");
    expect(viewFromPath("/live/")).toBe("live");
    expect(viewFromPath("/exceptions")).toBe("exceptions");
    expect(viewFromPath("/exceptions/")).toBe("exceptions");
    expect(viewFromPath("/places")).toBe("places");
    expect(viewFromPath("/places/")).toBe("places");
    expect(viewFromPath("/route")).toBe("routePlan");
    expect(viewFromPath("/route/")).toBe("routePlan");
    expect(viewFromPath("/jobs")).toBe("dispatchDesk");
    expect(viewFromPath("/jobs/")).toBe("dispatchDesk");
    expect(viewFromPath("/goods")).toBe("dispatchGoods");
    expect(viewFromPath("/goods/")).toBe("dispatchGoods");
    expect(viewFromPath("/jobs/goods")).toBe("dispatchGoods");
    expect(viewFromPath("/customers")).toBe("dispatchCustomers");
    expect(viewFromPath("/customers/")).toBe("dispatchCustomers");
    expect(viewFromPath("/jobs/customers")).toBe("dispatchCustomers");
    expect(viewFromPath("/dispatch-live")).toBe("dispatchLive");
    expect(viewFromPath("/dispatch-live/")).toBe("dispatchLive");
    expect(viewFromPath("/jobs/live")).toBe("dispatchLive");
    expect(viewFromPath("/maintenance")).toBe("maintenance");
    expect(viewFromPath("/maintenance/")).toBe("maintenance");
    expect(viewFromPath("/admin")).toBe("admin");
    expect(viewFromPath("/admin/")).toBe("admin");
    expect(viewFromPath("/m")).toBe("field");
    expect(viewFromPath("/m/")).toBe("field");
    expect(viewFromPath("/mm")).toBe("manager");
    expect(viewFromPath("/mm/")).toBe("manager");
    expect(viewFromPath("/dispatch")).toBe("field");
    expect(viewFromPath("/")).toBe("admin");
    expect(viewFromPath("/full")).toBe("full");
    expect(viewFromPath("/full/")).toBe("full");
  });
});

describe("isCompactPath", () => {
  it("matches compact routes", () => {
    expect(isCompactPath("/compact")).toBe(true);
    expect(isCompactPath("/compact.html")).toBe(true);
  });

  it("rejects the full dashboard and fleet pages", () => {
    expect(isCompactPath("/")).toBe(false);
    expect(isCompactPath("/full")).toBe(false);
    expect(isCompactPath("/index.html")).toBe(false);
    expect(isCompactPath("/metrics")).toBe(false);
    expect(isCompactPath("/fleet")).toBe(false);
    expect(isCompactPath("/fleet/compact")).toBe(false);
    expect(isCompactPath("/status")).toBe(false);
    expect(isCompactPath("/trips")).toBe(false);
  });
});

describe("vehicleTrackHref", () => {
  it("uses Armada trips/full for positive row ids", () => {
    expect(vehicleTrackHref({ rowId: 42, kind: "trips" })).toContain("/trips");
    expect(vehicleTrackHref({ rowId: 42, kind: "full" })).toContain("/full");
    expect(vehicleTrackHref({ rowId: 42, kind: "trips" })).toContain("userId=42");
  });

  it("uses Fleet Live for GPS-only rows with deviceId", () => {
    const href = vehicleTrackHref({
      rowId: -9,
      deviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      kind: "trips",
    });
    expect(href.startsWith(fleetLiveHref(""))).toBe(true);
    expect(href).toContain("deviceId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(href).toContain("section=trips");
  });

  it("redirects Armada trip views that carry a deviceId", () => {
    const href = armadaTripViewRedirectHref(
      "?k=tenant&userId=7&deviceId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(href).toContain("/fleet-live");
    expect(href).toContain("deviceId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(armadaTripViewRedirectHref("?userId=7")).toBeNull();
  });

  it("prefers Fleet Live for devices-only telematics when linked", () => {
    const href = vehicleTrackHref({
      rowId: 7,
      deviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      kind: "full",
      telematicsSource: "devices",
    });
    expect(href).toContain("/fleet-live");
    expect(href).toContain("section=full");
    expect(href).not.toContain("userId=");
  });

  it("stamps tenant key onto Fleet Live hrefs", () => {
    const href = vehicleTrackHref({
      rowId: 0,
      deviceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      kind: "full",
      tenantKey: "acme-tenant-key-1",
    });
    expect(href).toContain("k=acme-tenant-key-1");
    expect(href).toContain("/fleet-live");
  });
});

describe("withSearch", () => {
  it("keeps the query string on each view", () => {
    const q = "?groupId=12&userId=99&embed=1";
    expect(compactHref(q)).toBe("/compact?groupId=12&userId=99&embed=1");
    expect(fullHref(q)).toBe("/full?groupId=12&userId=99&embed=1");
    expect(fleetHref(q)).toBe("/fleet?groupId=12&userId=99&embed=1");
    expect(fleetCompactHref(q)).toBe("/fleet/compact?groupId=12&userId=99&embed=1");
    expect(statusHref(q)).toBe("/status?groupId=12&userId=99&embed=1");
    expect(tripsHref(q)).toBe("/trips?groupId=12&userId=99&embed=1");
    expect(liveHref(q)).toBe("/live?groupId=12&userId=99&embed=1");
    expect(exceptionsHref(q)).toBe("/exceptions?groupId=12&userId=99&embed=1");
    expect(placesHref(q)).toBe("/places?groupId=12&userId=99&embed=1");
    expect(routePlanHref(q)).toBe("/route?groupId=12&userId=99&embed=1");
    expect(jobsHref(q)).toBe("/jobs?groupId=12&userId=99&embed=1");
    expect(goodsHref(q)).toBe("/goods?groupId=12&userId=99&embed=1");
    expect(customersHref(q)).toBe("/customers?groupId=12&userId=99&embed=1");
    expect(dispatchLiveHref(q)).toBe("/dispatch-live?groupId=12&userId=99&embed=1");
    expect(maintenanceHref(q)).toBe("/maintenance?groupId=12&userId=99&embed=1");
    expect(withSearch("/compact", "")).toBe("/compact");
  });
});
