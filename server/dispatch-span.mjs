/**
 * Multi-day tour span helpers.
 *
 * A job covers `service_date .. end_date`; each stop names its day with
 * `day_index` (0 = service_date). `end_date IS NULL` is the single-day case, which
 * is what every job looked like before multi-day existed — keeping that meaning
 * rather than backfilling is what makes single-day behaviour byte-for-byte
 * unchanged.
 *
 * Lives in its own module because both dispatch-api and dispatch-recovery need it,
 * and dispatch-api already imports dispatch-live which imports dispatch-recovery.
 */
import { dbQuery } from "./db.mjs";
import { addDays, dayDiff, formatServiceDate } from "./service-day.mjs";

/** Matches the 0..30 check in migration 028. */
export const MAX_DAY_INDEX = 30;

export function clampDayIndex(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_DAY_INDEX, Math.max(0, Math.trunc(n)));
}

/** Number of calendar days a job covers; always at least 1. */
export function spanDayCount(serviceDate, endDate) {
  const start = formatServiceDate(serviceDate);
  const end = formatServiceDate(endDate) || start;
  if (!start) return 1;
  return Math.max(1, (dayDiff(start, end) ?? 0) + 1);
}

/** The calendar date of a stop within its job. */
export function dateForDayIndex(serviceDate, dayIndex) {
  const start = formatServiceDate(serviceDate);
  if (!start) return "";
  return addDays(start, clampDayIndex(dayIndex));
}

/**
 * Which day of the tour a date falls on, or null when it is outside the span.
 * @returns {number|null} zero-based day index
 */
export function dayIndexForDate(serviceDate, endDate, date) {
  const start = formatServiceDate(serviceDate);
  const target = formatServiceDate(date);
  if (!start || !target) return null;
  const offset = dayDiff(start, target);
  if (offset == null || offset < 0) return null;
  if (offset >= spanDayCount(start, endDate)) return null;
  return offset;
}

/**
 * Recompute a job's span from its stops.
 *
 * Called after any change to which days a job touches. Collapses back to NULL when
 * every stop sits on day 0, so a job that never became multi-day is
 * indistinguishable from before.
 */
export async function recomputeJobSpan(jobId) {
  if (!jobId) return null;
  const res = await dbQuery(
    `UPDATE dispatch_jobs j
     SET end_date = CASE
           WHEN COALESCE(m.max_day, 0) > 0 THEN j.service_date + COALESCE(m.max_day, 0)
           ELSE NULL
         END,
         updated_at = now()
     FROM (
       SELECT MAX(day_index) AS max_day FROM dispatch_stops WHERE job_id = $1
     ) m
     WHERE j.id = $1
       AND j.end_date IS DISTINCT FROM CASE
             WHEN COALESCE(m.max_day, 0) > 0 THEN j.service_date + COALESCE(m.max_day, 0)
             ELSE NULL
           END
     RETURNING j.end_date`,
    [jobId],
  );
  return res.rows[0] ? formatServiceDate(res.rows[0].end_date) : null;
}
