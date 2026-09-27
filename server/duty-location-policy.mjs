/**
 * Tenant Field GPS cadence. Defaults match the original duty filter:
 * 15s while moving, 60s parked, 25 m.
 */
export const DUTY_LOCATION_DEFAULTS = {
  intervalSec: 15,
  quietSec: 60,
  minMoveM: 25,
};

function clampInt(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeDutyLocationPolicy(raw = {}, env = process.env) {
  const intervalSec = clampInt(
    raw.intervalSec ?? raw.duty_ping_interval_sec ?? env.DUTY_PING_INTERVAL_SEC,
    5,
    120,
    DUTY_LOCATION_DEFAULTS.intervalSec,
  );
  const quietSec = clampInt(
    raw.quietSec ?? raw.duty_ping_quiet_sec ?? env.DUTY_PING_QUIET_SEC,
    intervalSec,
    600,
    Math.max(DUTY_LOCATION_DEFAULTS.quietSec, intervalSec),
  );
  const minMoveM = clampInt(
    raw.minMoveM ?? raw.duty_ping_min_move_m ?? env.DUTY_PING_MIN_MOVE_M,
    5,
    200,
    DUTY_LOCATION_DEFAULTS.minMoveM,
  );
  return { intervalSec, quietSec, minMoveM };
}

export function dutyLocationFromTenantRow(row, env = process.env) {
  return normalizeDutyLocationPolicy(
    {
      intervalSec: row?.duty_ping_interval_sec,
      quietSec: row?.duty_ping_quiet_sec,
      minMoveM: row?.duty_ping_min_move_m,
    },
    env,
  );
}
