export const DEFAULT_APP_ID = 36;
export const APP_ID = DEFAULT_APP_ID;

export const API_PREFIX = "/lt/api/v.1/applications";

export const MAX_POSITION_JUMP_KM = 1.5;
export const MAX_GAP_MS = 5 * 60 * 1000;
export const MAX_HOURS_PER_DAY = 24;
/** Ignore consecutive altitude steps smaller than this (typical GPS dither). */
export const MIN_ALTITUDE_STEP_M = 5;
/** Rebase without counting when a single step exceeds this (GPS lock jump). */
export const MAX_ALTITUDE_JUMP_M = 80;
/** Rebase without counting when implied climb/descent exceeds this (m/s). */
export const MAX_VERTICAL_SPEED_MS = 5;
/**
 * V8 heuristic: 1 m of gain ≈ 0.1% extra fuel per km driven.
 * Applied as a multiplier so flat-equivalent km/l is higher than hilly actual.
 */
export const TERRAIN_GAIN_PCT_PER_M_PER_KM = 0.1;
export const DEFAULT_MIN_SPEED_KMH = 3;
export const DEFAULT_TRIP_BREAK_MIN = 5;
export const DEFAULT_TZ = "+08:00";
export const DEFAULT_FUEL_PRICE = 10500;
export const DEFAULT_REFILL_THRESHOLD_L = 8;
export const REFILL_STEP_L = 0.5;
export const REFILL_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_HARSH_BRAKE = 6.5;
export const DEFAULT_HARSH_ACCEL = 4.5;
export const DEFAULT_HARSH_CORNER = 0.6;
export const DEFAULT_SPEED_LIMIT_KMH = 90;
/** Max vehicles loaded together on the fleet pages. */
export const FLEET_VEHICLE_CAP = 8;
/** Track ids in one POST /api/tracks-batch (server fetches them in parallel). */
export const TRACK_BATCH_SIZE = 20;
/** Vehicle-days in one POST /api/user-day-tracks. */
export const USER_DAY_BATCH_SIZE = 20;
/** How many batch POSTs the browser runs at once. */
export const TRACK_BATCH_BROWSER = 2;
/** Fallback if the batch endpoint is missing (direct /lt track GETs). */
export const TRACK_FETCH_CONCURRENCY = 8;
export const API_RETRY_ATTEMPTS = 8;
export const API_RETRY_CAP_MS = 12_000;
/** Road vibration buckets in mG (1 G = 1000 mG), matching V8. */
export const ROAD_ROUGH_MG = 150;
export const ROAD_BUMPY_MG = 300;

export const TIMEZONES = [
  { value: "+07:00", label: "WIB · UTC+7" },
  { value: "+08:00", label: "WITA · UTC+8" },
  { value: "+09:00", label: "WIT · UTC+9" },
  { value: "+00:00", label: "UTC" },
] as const;
