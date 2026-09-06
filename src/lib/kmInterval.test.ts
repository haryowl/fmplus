import { describe, expect, it } from "vitest";

// Mirror server evaluateKmInterval for unit tests (keep in sync with server/odometer-status.mjs)
function evaluateKmInterval(input: {
  currentOdoKm: number | null;
  baselineKm: number | null;
  intervalKm: number | null;
}) {
  const { intervalKm, baselineKm, currentOdoKm } = input;
  if (intervalKm == null || !(intervalKm > 0)) {
    return { kmAccrued: null, due: false, reason: "no_interval" as const };
  }
  if (baselineKm == null || !Number.isFinite(baselineKm)) {
    return { kmAccrued: null, due: false, reason: "no_baseline" as const };
  }
  if (currentOdoKm == null || !Number.isFinite(currentOdoKm)) {
    return { kmAccrued: null, due: false, reason: "no_status_odo" as const };
  }
  const kmAccrued = Math.max(0, currentOdoKm - baselineKm);
  const nextDueOdoKm = baselineKm + intervalKm;
  return {
    kmAccrued: Math.round(kmAccrued * 10) / 10,
    nextDueOdoKm: Math.round(nextDueOdoKm * 10) / 10,
    due: currentOdoKm >= nextDueOdoKm,
    reason: null,
  };
}

describe("evaluateKmInterval", () => {
  it("marks due when current odo reaches baseline + interval", () => {
    const r = evaluateKmInterval({ baselineKm: 10000, intervalKm: 5000, currentOdoKm: 15000 });
    expect(r.due).toBe(true);
    expect(r.kmAccrued).toBe(5000);
  });

  it("reports progress before due", () => {
    const r = evaluateKmInterval({ baselineKm: 10000, intervalKm: 5000, currentOdoKm: 12000 });
    expect(r.due).toBe(false);
    expect(r.kmAccrued).toBe(2000);
  });

  it("needs baseline", () => {
    expect(evaluateKmInterval({ baselineKm: null, intervalKm: 5000, currentOdoKm: 1 }).reason).toBe(
      "no_baseline",
    );
  });
});
