import { describe, expect, it } from "vitest";
import {
  cargoFromOrderCsvRow,
  orderCsvAllowsGoodsLines,
  pickupFromOrderCsvRow,
  resolveOrderCsvProfile,
} from "../../server/dispatch-order-csv.mjs";
import { DISPATCH_ORDER_CSV_HEADERS, dispatchOrderCsvTemplate } from "./csvImport";

describe("order CSV headers / template", () => {
  it("includes profile, passenger, luggage, and pickup columns", () => {
    expect(DISPATCH_ORDER_CSV_HEADERS).toContain("profile");
    expect(DISPATCH_ORDER_CSV_HEADERS).toContain("passenger_count");
    expect(DISPATCH_ORDER_CSV_HEADERS).toContain("luggage_kg");
    expect(DISPATCH_ORDER_CSV_HEADERS).toContain("kind");
    expect(DISPATCH_ORDER_CSV_HEADERS).toContain("pickup_lat");
    expect(DISPATCH_ORDER_CSV_HEADERS).toContain("pickup_lon");
    const csv = dispatchOrderCsvTemplate();
    expect(csv).toMatch(/^customer_name,lat,lon,.*profile,volume_m3,weight_kg,passenger_count,luggage_kg/);
    expect(csv).toContain("passenger");
    expect(csv).toContain("sales");
    expect(csv).toContain("cargo");
  });
});

describe("resolveOrderCsvProfile", () => {
  it("reads explicit profile", () => {
    expect(resolveOrderCsvProfile({ profile: "sales" })).toBe("sales");
    expect(resolveOrderCsvProfile({ profile: "Passenger" })).toBe("passenger");
    expect(resolveOrderCsvProfile({ profile: "cargo" })).toBe("cargo");
  });

  it("infers passenger from passenger_count / luggage_kg when profile blank", () => {
    expect(resolveOrderCsvProfile({ passenger_count: "2" })).toBe("passenger");
    expect(resolveOrderCsvProfile({ luggage_kg: "10" })).toBe("passenger");
    expect(resolveOrderCsvProfile({ customer_name: "A" })).toBe("cargo");
  });
});

describe("cargoFromOrderCsvRow", () => {
  it("maps passenger demand onto volume/weight", () => {
    const cargo = cargoFromOrderCsvRow({ profile: "passenger", passenger_count: "3", luggage_kg: "20" });
    expect(cargo.passengerCount).toBe(3);
    expect(cargo.luggageKg).toBe(20);
    expect(cargo.volumeM3).toBeGreaterThan(0);
    expect(cargo.weightKg).toBeGreaterThan(0);
  });

  it("defaults passenger_count to 1 when profile is passenger", () => {
    const cargo = cargoFromOrderCsvRow({ profile: "passenger" });
    expect(cargo.passengerCount).toBe(1);
  });

  it("clears cargo for sales visits", () => {
    expect(cargoFromOrderCsvRow({ profile: "sales", volume_m3: "9", weight_kg: "50" })).toEqual({
      volumeM3: null,
      weightKg: null,
      passengerCount: null,
      luggageKg: null,
    });
  });

  it("keeps cargo volume/weight for cargo rows", () => {
    expect(cargoFromOrderCsvRow({ volume_m3: "2.5", weight_kg: "120" })).toEqual({
      volumeM3: 2.5,
      weightKg: 120,
      passengerCount: null,
      luggageKg: null,
    });
  });
});

describe("orderCsvAllowsGoodsLines", () => {
  it("only cargo attaches goods lines", () => {
    expect(orderCsvAllowsGoodsLines("cargo")).toBe(true);
    expect(orderCsvAllowsGoodsLines("passenger")).toBe(false);
    expect(orderCsvAllowsGoodsLines("sales")).toBe(false);
  });
});

describe("pickupFromOrderCsvRow", () => {
  it("requires pickup pin for pickup_drop", () => {
    expect(pickupFromOrderCsvRow({ kind: "pickup_drop" }).error).toMatch(/pickup_lat/);
    expect(
      pickupFromOrderCsvRow({ kind: "pickup_drop", pickup_lat: "-6.2", pickup_lon: "106.8" }).error,
    ).toBeUndefined();
  });

  it("defaults kind to drop", () => {
    expect(pickupFromOrderCsvRow({}).kind).toBe("drop");
  });
});
