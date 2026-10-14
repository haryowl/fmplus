import { describe, expect, it } from "vitest";
import { computeOperatingCost, contributionMargin } from "../../server/dispatch-opex.mjs";
import { jobContributionMargin, sumJobGoodsMoney } from "./dispatch";
import type { DispatchJob } from "./dispatch";

describe("computeOperatingCost", () => {
  it("sums km + stop + fixed + hour in IDR", () => {
    // 100km×500 + 4×2000 + 15000 + 2h×10000 = 50000+8000+15000+20000 = 93000
    expect(
      computeOperatingCost({
        distanceKm: 100,
        stopCount: 4,
        durationSec: 7200,
        rateKm: 500,
        rateStop: 2000,
        rateHour: 10000,
        fixedTrip: 15000,
      }),
    ).toBe(93000);
  });

  it("floors stop count and clamps negatives", () => {
    expect(
      computeOperatingCost({
        distanceKm: -10,
        stopCount: 2.9,
        durationSec: -100,
        rateKm: 100,
        rateStop: 1000,
        rateHour: 1000,
        fixedTrip: 500,
      }),
    ).toBe(2500);
  });

  it("rounds fractional totals", () => {
    expect(
      computeOperatingCost({
        distanceKm: 1.5,
        stopCount: 1,
        durationSec: 1800,
        rateKm: 100.4,
        rateStop: 0,
        rateHour: 0,
        fixedTrip: 0,
      }),
    ).toBe(151);
  });
});

describe("contributionMargin", () => {
  it("is sell − cogs − opex", () => {
    expect(
      contributionMargin({ goodsSubtotal: 100000, goodsCostSubtotal: 40000, opex: 15000 }),
    ).toBe(45000);
  });

  it("returns null without sell", () => {
    expect(contributionMargin({ goodsSubtotal: null, opex: 1000 })).toBe(null);
  });

  it("treats missing cogs/opex as 0", () => {
    expect(contributionMargin({ goodsSubtotal: 50000 })).toBe(50000);
  });
});

describe("jobContributionMargin (client)", () => {
  const job: DispatchJob = {
    id: "j1",
    status: "assigned",
    title: "Trip",
    notes: "",
    armadaUserId: null,
    armadaUsername: "",
    userDisplayName: "",
    assignedFieldUserId: null,
    assignedAt: null,
    startedAt: null,
    arrivedAt: null,
    completedAt: null,
    fieldNote: "",
    serviceDate: "2026-10-14",
    createdAt: "",
    updatedAt: "",
    opexEstimate: 12000,
    opexActual: null,
    stops: [
      {
        id: "s1",
        orderId: "o1",
        sortOrder: 0,
        name: "A",
        address: "",
        lat: null,
        lon: null,
        notes: "",
        status: "pending",
        arrivedAt: null,
        completedAt: null,
        role: "pickup",
        lines: [
          { name: "Oil", qty: 2, unit: "pcs", unitPrice: 10000, costPrice: 6000, lineAmount: 20000 },
        ],
      },
      {
        id: "s2",
        orderId: "o1",
        sortOrder: 1,
        name: "B",
        address: "",
        lat: null,
        lon: null,
        notes: "",
        status: "pending",
        arrivedAt: null,
        completedAt: null,
        role: "drop",
        lines: [
          { name: "Oil", qty: 2, unit: "pcs", unitPrice: 10000, costPrice: 6000, lineAmount: 20000 },
        ],
      },
    ],
  };

  it("dedupes pickup/drop lines and subtracts opex", () => {
    expect(sumJobGoodsMoney(job)).toEqual({ goodsSubtotal: 20000, goodsCostSubtotal: 12000 });
    expect(jobContributionMargin(job)).toEqual({
      goodsSubtotal: 20000,
      goodsCostSubtotal: 12000,
      opex: 12000,
      margin: -4000,
    });
  });

  it("prefers actual opex when present", () => {
    expect(jobContributionMargin({ ...job, opexActual: 8000 }).margin).toBe(0);
  });
});
