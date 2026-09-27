export type DutyLocationPolicy = {
  /** Fastest record while moving. */
  intervalSec: number;
  /** Heartbeat while parked. Must be >= intervalSec. */
  quietSec: number;
  /** Metres the phone must move after intervalSec. */
  minMoveM: number;
};

export const DEFAULT_DUTY_LOCATION_POLICY: DutyLocationPolicy = {
  intervalSec: 15,
  quietSec: 60,
  minMoveM: 25,
};

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Clamp Admin / Field / env values. Interval 5–120s, quiet 15–600s, move 5–200m. */
export function normalizeDutyLocationPolicy(
  raw?: Partial<DutyLocationPolicy> | null,
): DutyLocationPolicy {
  const intervalSec = clampInt(raw?.intervalSec, 5, 120, DEFAULT_DUTY_LOCATION_POLICY.intervalSec);
  const quietSec = clampInt(raw?.quietSec, intervalSec, 600, Math.max(DEFAULT_DUTY_LOCATION_POLICY.quietSec, intervalSec));
  const minMoveM = clampInt(raw?.minMoveM, 5, 200, DEFAULT_DUTY_LOCATION_POLICY.minMoveM);
  return { intervalSec, quietSec, minMoveM };
}
