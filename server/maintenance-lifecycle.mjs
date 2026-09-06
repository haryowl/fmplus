/**
 * Pure work-order lifecycle helpers (shared by API + tests).
 *
 * Lifecycle:
 *   due → in_progress (Start)
 *   in_progress → due (Cancel start)
 *   in_progress → done (Done)
 *   done → approved (manager Approve — terminal lock)
 *   due|in_progress → skipped
 *   done|skipped → due (manager Reopen; not from approved)
 */

export function canTransition(from, to) {
  if (from === to) return true;
  if (from === "due" && (to === "in_progress" || to === "skipped")) return true;
  if (from === "in_progress" && (to === "done" || to === "skipped" || to === "due")) return true;
  if (from === "done" && (to === "approved" || to === "due")) return true;
  if (from === "skipped" && to === "due") return true;
  return false;
}

/** Minutes between Start and Done/Skip timestamps. */
export function serviceDurationMinutes(startedAt, endedAt) {
  if (!startedAt || !endedAt) return null;
  const a = Date.parse(startedAt);
  const b = Date.parse(endedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 60000);
}

/**
 * Calendar next-due after completion.
 * @param {{ endedAt?: string|null, remindIntervalDays?: number|null }} completed
 * @param {string|Date} [nowIso]
 * @returns {string|null} ISO timestamp strictly after completion
 */
export function nextScheduleDueAt(completed, nowIso) {
  const intervalDays = Number(completed?.remindIntervalDays);
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) return null;
  const endedMs = Date.parse(completed?.endedAt || nowIso || new Date().toISOString());
  if (!Number.isFinite(endedMs)) return null;
  const nextMs = endedMs + intervalDays * 86400000;
  return new Date(nextMs).toISOString();
}
