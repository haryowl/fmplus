import { describe, expect, it } from "vitest";
import {
  computePassengerFare,
  passengerCapsToCargo,
  passengerDemandToCargo,
} from "../../server/dispatch-fare.mjs";
import { parseDispatchProfiles, resolveDispatchDeskMode } from "../../server/dispatch-profiles.mjs";
import {
  defaultEntitlements,
  dispatchProfiles,
  mergeEntitlements,
  resolveDispatchDeskMode as clientResolveMode,
} from "./entitlements";

describe("computePassengerFare", () => {
  it("is km × rate + fixed booking", () => {
    expect(computePassengerFare({ distanceKm: 12.5, rateKm: 4000, fixedBooking: 10000 })).toBe(60000);
  });

  it("clamps negative distance and rounds", () => {
    expect(computePassengerFare({ distanceKm: -3, rateKm: 1000, fixedBooking: 500.4 })).toBe(500);
  });
});

describe("passenger demand/capacity mapping", () => {
  it("maps seats and luggage onto CVRP volume/weight axes", () => {
    expect(passengerDemandToCargo({ passengerCount: 3, luggageKg: 25 })).toEqual({
      volumeM3: 3,
      weightKg: 25,
      passengerCount: 3,
      luggageKg: 25,
    });
    expect(passengerCapsToCargo({ seatCapacity: 7, luggageCapacityKg: 80 })).toEqual({
      volumeCapacityM3: 7,
      weightCapacityKg: 80,
      seatCapacity: 7,
      luggageCapacityKg: 80,
    });
  });

  it("defaults seats/luggage when unset", () => {
    expect(passengerCapsToCargo({})).toEqual({
      volumeCapacityM3: 4,
      weightCapacityKg: 50,
      seatCapacity: 4,
      luggageCapacityKg: 50,
    });
  });
});

describe("dispatch profiles", () => {
  it("defaults cargo on, passenger/sales off", () => {
    expect(dispatchProfiles(defaultEntitlements())).toEqual({
      cargo: true,
      passenger: false,
      sales: false,
    });
    expect(parseDispatchProfiles(null)).toEqual({
      cargo: true,
      passenger: false,
      sales: false,
    });
  });

  it("enables passenger via feature flag", () => {
    const ent = mergeEntitlements({
      features: { dispatchPassenger: true, dispatchCargo: false },
    });
    expect(dispatchProfiles(ent)).toEqual({
      cargo: false,
      passenger: true,
      sales: false,
    });
    expect(clientResolveMode(dispatchProfiles(ent))).toBe("passenger");
    expect(resolveDispatchDeskMode(parseDispatchProfiles(ent), "cargo")).toBe("passenger");
  });

  it("honors preferred mode when both profiles enabled", () => {
    const both = { cargo: true, passenger: true, sales: false };
    expect(resolveDispatchDeskMode(both, "passenger")).toBe("passenger");
    expect(resolveDispatchDeskMode(both, "cargo")).toBe("cargo");
  });
});
