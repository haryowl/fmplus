import { describe, expect, it } from "vitest";
import {
  inferJobProfile,
  jobMatchesDeskMode,
  orderMatchesDeskMode,
  parseVisitOutcome,
  salesVisitRequiresOutcome,
  tallyVisitOutcomes,
  VISIT_OUTCOMES,
} from "../../server/dispatch-sales.mjs";
import { tallyVisitOutcomes as clientTally } from "./dispatch";
import { enabledDeskModes, resolveDispatchDeskMode } from "../../server/dispatch-profiles.mjs";
import {
  dispatchProfiles,
  enabledDeskModes as clientEnabledModes,
  mergeEntitlements,
  resolveDispatchDeskMode as clientResolveMode,
} from "./entitlements";
import {
  inferJobProfile as clientInferJob,
  jobMatchesDeskMode as clientJobMatches,
  orderMatchesDeskMode as clientOrderMatches,
} from "./dispatch";
import type { DispatchJob } from "./dispatch";

describe("visit outcomes", () => {
  it("parses known outcomes", () => {
    expect(parseVisitOutcome("ordered")).toBe("ordered");
    expect(parseVisitOutcome("Not Home")).toBe("not_home");
    expect(parseVisitOutcome("no-interest")).toBe("no_interest");
    expect(parseVisitOutcome("lol")).toBe(null);
  });

  it("lists the locked v1 set", () => {
    expect(VISIT_OUTCOMES).toEqual([
      "visited",
      "not_home",
      "ordered",
      "follow_up",
      "no_interest",
    ]);
  });
});

describe("salesVisitRequiresOutcome", () => {
  it("only when tenant sales on and order profile is sales", () => {
    expect(salesVisitRequiresOutcome("sales", true)).toBe(true);
    expect(salesVisitRequiresOutcome("sales", false)).toBe(false);
    expect(salesVisitRequiresOutcome("cargo", true)).toBe(false);
    expect(salesVisitRequiresOutcome(null, true)).toBe(false);
  });
});

describe("desk mode with sales", () => {
  it("resolves sales-only tenants", () => {
    const profiles = { cargo: false, passenger: false, sales: true };
    expect(resolveDispatchDeskMode(profiles, "cargo")).toBe("sales");
    expect(clientResolveMode(profiles, "sales")).toBe("sales");
    expect(enabledDeskModes(profiles)).toEqual(["sales"]);
  });

  it("lists all enabled modes", () => {
    const ent = mergeEntitlements({
      features: { dispatchPassenger: true, dispatchSales: true },
    });
    const profiles = dispatchProfiles(ent);
    expect(clientEnabledModes(profiles)).toEqual(["cargo", "passenger", "sales"]);
    expect(clientResolveMode(profiles, "sales")).toBe("sales");
  });
});

describe("tallyVisitOutcomes", () => {
  it("counts outcomes and conversion", () => {
    const tallied = tallyVisitOutcomes([
      { visitOutcome: "ordered" },
      { visit_outcome: "ordered" },
      { visitOutcome: "not_home" },
      { visitOutcome: "visited" },
      { visitOutcome: null },
    ]);
    expect(tallied.total).toBe(4);
    expect(tallied.ordered).toBe(2);
    expect(tallied.conversionPct).toBe(50);
    expect(tallied.byOutcome.not_home).toBe(1);
    expect(clientTally([{ visitOutcome: "ordered" }, { visitOutcome: "follow_up" }])).toEqual({
      byOutcome: {
        visited: 0,
        not_home: 0,
        ordered: 1,
        follow_up: 1,
        no_interest: 0,
      },
      total: 2,
      ordered: 1,
      conversionPct: 50,
    });
  });
});

describe("job / order desk matching", () => {
  it("classifies empty shells as open (cargo + sales)", () => {
    expect(inferJobProfile({ seat_capacity: null }, [])).toBe("open");
    expect(jobMatchesDeskMode({ seat_capacity: null }, [], "sales")).toBe(true);
    expect(jobMatchesDeskMode({ seat_capacity: null }, [], "cargo")).toBe(true);
    expect(jobMatchesDeskMode({ seat_capacity: null }, [], "passenger")).toBe(false);
  });

  it("prefers sales / passenger from stops or seats", () => {
    expect(inferJobProfile({}, [{ order_profile: "sales" }])).toBe("sales");
    expect(inferJobProfile({ seat_capacity: 4 }, [])).toBe("passenger");
    expect(orderMatchesDeskMode({ profile: "passenger" }, "passenger")).toBe(true);
    expect(orderMatchesDeskMode({ profile: null }, "cargo")).toBe(true);
  });

  it("mirrors client helpers", () => {
    const empty = { seatCapacity: null, stops: [] } as Pick<DispatchJob, "seatCapacity" | "stops">;
    expect(clientInferJob(empty)).toBe("open");
    expect(clientJobMatches(empty, "sales")).toBe(true);
    expect(clientOrderMatches({ profile: "sales" }, "sales")).toBe(true);
  });
});
