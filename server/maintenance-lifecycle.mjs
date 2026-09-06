/**
 * Pure work-order lifecycle helpers (shared by API + tests).
 *
 * Lifecycle (CMMS-aligned):
 *   due → in_progress (Start)
 *   in_progress → due (Cancel start, before Done)
 *   in_progress → done (Done; records service time)
 *   due|in_progress → skipped
 *   done|skipped → due (Reopen — manager only in API)
 */

export function canTransition(from, to) {
  if (from === to) return true;
  if (from === "due" && (to === "in_progress" || to === "skipped")) return true;
  if (from === "in_progress" && (to === "done" || to === "skipped" || to === "due")) return true;
  if ((from === "done" || from === "skipped") && to === "due") return true;
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
