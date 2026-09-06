/**
 * Schedule health: upcoming → due → overdue (whichever meter comes first).
 * Calendar + km (+ optional hoursAccrued) — used by board dashboard and list enrich.
 */

export const SCHEDULE_HEALTH = ["none", "ok", "upcoming", "due", "overdue"];

const RANK = { none: -1, ok: 0, upcoming: 1, due: 2, overdue: 3 };

/**
 * Classify one remaining/before pair.
 * remaining > before → ok
 * 0 < remaining ≤ before → upcoming
 * -before < remaining ≤ 0 → due
 * remaining ≤ -before → overdue
 * @param {number|null|undefined} remaining
 * @param {number} before
 * @returns {'ok'|'upcoming'|'due'|'overdue'|null}
 */
export function classifyRemaining(remaining, before) {
  if (remaining == null || !Number.isFinite(remaining)) return null;
  const lead = Number.isFinite(before) && before > 0 ? before : 0;
  if (remaining > lead) return "ok";
  if (remaining > 0) return "upcoming";
  if (lead > 0 && remaining > -lead) return "due";
  if (remaining <= 0) return lead > 0 ? "overdue" : "due";
  return "ok";
}

function worse(a, b) {
  return (RANK[a] ?? -1) >= (RANK[b] ?? -1) ? a : b;
}

/**
 * @param {object} ev publicEvent-shaped
 * @param {{ now?: number, currentOdoKm?: number|null, hoursAccrued?: number|null }} meters
 */
export function computeScheduleHealth(ev, meters = {}) {
  const now = meters.now ?? Date.now();
  const bits = [];
  let health = "none";

  const hasSchedule = Boolean(
    ev.remindDueAt ||
      (ev.remindIntervalDays != null && ev.remindIntervalDays > 0) ||
      (ev.remindIntervalKm != null && ev.remindIntervalKm > 0) ||
      (ev.remindIntervalHours != null && ev.remindIntervalHours > 0),
  );
  if (!hasSchedule) {
    return { health: "none", bits: [], urgency: RANK.none };
  }

  health = "ok";

  const beforeDays = ev.remindBeforeDays ?? 7;
  if (ev.remindDueAt) {
    const dueMs = Date.parse(ev.remindDueAt);
    if (Number.isFinite(dueMs)) {
      const remainingDays = (dueMs - now) / 86400000;
      const c = classifyRemaining(remainingDays, beforeDays);
      if (c) {
        health = worse(health, c);
        bits.push(`date ${remainingDays >= 0 ? `in ${remainingDays.toFixed(0)}d` : `${Math.abs(remainingDays).toFixed(0)}d past`}`);
      }
    }
  } else if (ev.remindIntervalDays != null && ev.remindIntervalDays > 0) {
    const start = Date.parse(ev.createdAt || "");
    if (Number.isFinite(start)) {
      const dueMs = start + ev.remindIntervalDays * 86400000;
      const remainingDays = (dueMs - now) / 86400000;
      const c = classifyRemaining(remainingDays, beforeDays);
      if (c) {
        health = worse(health, c);
        bits.push(`interval ${ev.remindIntervalDays}d (${remainingDays.toFixed(0)}d left)`);
      }
    }
  }

  const beforeKm = ev.remindBeforeKm ?? 500;
  if (ev.remindIntervalKm != null && ev.remindIntervalKm > 0) {
    let baseline = ev.remindBaselineOdometerKm;
    if (baseline == null && ev.odometerKm != null) baseline = ev.odometerKm;
    const current = meters.currentOdoKm;
    if (baseline != null && Number.isFinite(baseline) && current != null && Number.isFinite(current)) {
      const accrued = Math.max(0, current - baseline);
      const remaining = ev.remindIntervalKm - accrued;
      const c = classifyRemaining(remaining, beforeKm);
      if (c) {
        health = worse(health, c);
        bits.push(`km ${remaining >= 0 ? `${remaining.toFixed(0)} left` : `${Math.abs(remaining).toFixed(0)} over`}`);
      }
    }
  }

  const beforeHours =
    ev.remindBeforeHours ??
    (ev.remindIntervalHours != null ? Math.max(1, ev.remindIntervalHours * 0.1) : 10);
  if (ev.remindIntervalHours != null && ev.remindIntervalHours > 0) {
    const accrued = meters.hoursAccrued;
    if (accrued != null && Number.isFinite(accrued)) {
      const remaining = ev.remindIntervalHours - accrued;
      const c = classifyRemaining(remaining, beforeHours);
      if (c) {
        health = worse(health, c);
        bits.push(`hours ${remaining >= 0 ? `${remaining.toFixed(1)} left` : `${Math.abs(remaining).toFixed(1)} over`}`);
      }
    }
  }

  return { health, bits, urgency: RANK[health] ?? 0 };
}

/**
 * Batch-enrich public events with scheduleHealth using one usersstatus fetch for km.
 * Hours are optional (pass hoursByEventId) — skipped on list by default for speed.
 * @param {object[]} events
 * @param {{ appId: number, token: string }|null|undefined} vaultTenant
 * @param {{ hoursByEventId?: Record<string, number>, now?: number }} opts
 */
export async function enrichEventsWithSchedule(events, vaultTenant, opts = {}) {
  const now = opts.now ?? Date.now();
  const hoursByEventId = opts.hoursByEventId || {};
  /** @type {Map<number, number>} */
  const odoByUser = new Map();

  const needKm = events.some(
    (e) =>
      e.remindIntervalKm != null &&
      e.remindIntervalKm > 0 &&
      e.armadaUserId &&
      (e.status === "due" || e.status === "in_progress"),
  );

  if (needKm && vaultTenant?.token && vaultTenant.appId) {
    try {
      const { armadaFetch } = await import("./proxy-lt.mjs");
      const { findOdometerKmInStatus } = await import("./odometer-status.mjs");
      const url = `https://armada.id/lt/api/v.1/applications/${vaultTenant.appId}/usersstatus`;
      const res = await armadaFetch(url, {
        method: "GET",
        headers: { authorization: vaultTenant.token, accept: "application/json" },
        timeoutMs: 45_000,
      });
      if (res.ok) {
        const raw = await res.json();
        for (const ev of events) {
          const uid = Number(ev.armadaUserId);
          if (!uid || odoByUser.has(uid)) continue;
          const odo = findOdometerKmInStatus(raw, uid);
          if (odo != null) odoByUser.set(uid, odo);
        }
      }
    } catch {
      /* ignore — calendar-only health */
    }
  }

  return events.map((ev) => {
    if (ev.status === "done" || ev.status === "skipped") {
      return {
        ...ev,
        scheduleHealth: ev.status === "done" ? "completed" : "none",
        scheduleBits: [],
      };
    }
    const uid = Number(ev.armadaUserId);
    const { health, bits, urgency } = computeScheduleHealth(ev, {
      now,
      currentOdoKm: uid ? odoByUser.get(uid) ?? null : null,
      hoursAccrued: hoursByEventId[ev.id] ?? null,
    });
    return { ...ev, scheduleHealth: health, scheduleBits: bits, scheduleUrgency: urgency };
  });
}

/**
 * @param {object[]} enriched
 */
export function summarizeSchedule(enriched) {
  const summary = { upcoming: 0, due: 0, overdue: 0, completed: 0, ok: 0, none: 0, open: 0 };
  for (const ev of enriched) {
    if (ev.status === "done") {
      summary.completed += 1;
      continue;
    }
    if (ev.status === "skipped") continue;
    if (ev.status === "due" || ev.status === "in_progress") summary.open += 1;
    const h = ev.scheduleHealth || "none";
    if (h === "upcoming") summary.upcoming += 1;
    else if (h === "due") summary.due += 1;
    else if (h === "overdue") summary.overdue += 1;
    else if (h === "ok") summary.ok += 1;
    else summary.none += 1;
  }
  return summary;
}
