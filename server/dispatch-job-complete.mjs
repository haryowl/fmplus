import { dbQuery } from "./db.mjs";

const OPENABLE = new Set(["assigned", "en_route", "arrived"]);

export function tourHasOpenStops(stops) {
  return (Array.isArray(stops) ? stops : []).some((s) => {
    const st = String(s?.status || s?.stopStatus || "").toLowerCase();
    return st !== "done" && st !== "skipped" && st !== "delivered";
  });
}

/** True when every customer stop is finished and the job is still in progress. */
export function shouldAutoCompleteJob(status, stops) {
  const st = String(status || "").toLowerCase();
  if (!OPENABLE.has(st)) return false;
  if (!Array.isArray(stops) || stops.length === 0) return false;
  return !tourHasOpenStops(stops);
}

/**
 * Mark a job done once its last stop is finished. Empty jobs stay open.
 * @returns {Promise<object|null>} updated row, or null if nothing changed
 */
export async function markJobDoneIfNoOpenStops(jobId, knownStops) {
  if (!jobId) return null;
  let stops = knownStops;
  if (!stops) {
    const found = await dbQuery(`SELECT status FROM dispatch_stops WHERE job_id = $1`, [jobId]);
    stops = found.rows;
  }
  if (!stops.length || tourHasOpenStops(stops)) return null;
  const updated = await dbQuery(
    `UPDATE dispatch_jobs
     SET status = 'done',
         completed_at = COALESCE(completed_at, now()),
         updated_at = now()
     WHERE id = $1
       AND status IN ('assigned', 'en_route', 'arrived')
     RETURNING *`,
    [jobId],
  );
  return updated.rows[0] || null;
}

/** Live card status when there is no current stop. */
export function liveDriverCurrentStatus(jobStatus, currentStopUiStatus, remainingOpenCount) {
  if (currentStopUiStatus) return currentStopUiStatus;
  const remaining = Number(remainingOpenCount);
  if (String(jobStatus || "").toLowerCase() === "done" || remaining === 0) {
    return "delivered";
  }
  return "pending";
}
