/**
 * Plan-day quality KPIs — post-pack summary for preview and future “improve” gates.
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {{
 *   routes?: Array<{
 *     orderIds?: string[],
 *     utilizationPct?: number,
 *     distanceKm?: number,
 *     lateStops?: number,
 *   }>,
 *   unassigned?: unknown[],
 *   orderCount?: number,
 *   balanceMoves?: number,
 *   startedAtMs?: number,
 *   endedAtMs?: number,
 * }} input
 */
export function computePlanDayKpis(input = {}) {
  const routes = Array.isArray(input.routes) ? input.routes : [];
  const unassigned = Array.isArray(input.unassigned) ? input.unassigned : [];
  const active = routes.filter((r) => (r.orderIds?.length || 0) > 0);

  const utils = active.map((r) => num(r.utilizationPct, 0));
  const distances = active.map((r) => num(r.distanceKm, 0));
  const assignedStops = active.reduce((n, r) => n + (r.orderIds?.length || 0), 0);
  const lateStops = active.reduce((n, r) => n + Math.max(0, Math.floor(num(r.lateStops, 0))), 0);
  const totalDistanceKm = round2(distances.reduce((a, b) => a + b, 0));

  const minUtilizationPct = utils.length ? round1(Math.min(...utils)) : 0;
  const maxUtilizationPct = utils.length ? round1(Math.max(...utils)) : 0;
  const avgUtilizationPct = utils.length
    ? round1(utils.reduce((a, b) => a + b, 0) / utils.length)
    : 0;
  const utilizationSpreadPct = utils.length ? round1(maxUtilizationPct - minUtilizationPct) : 0;

  const started = num(input.startedAtMs, NaN);
  const ended = num(input.endedAtMs, Date.now());
  const solveMs =
    Number.isFinite(started) && Number.isFinite(ended)
      ? Math.max(0, Math.round(ended - started))
      : null;

  const orderCount = Math.max(0, Math.floor(num(input.orderCount, 0)));
  const unassignedCount = unassigned.length;
  const assignedOrderEstimate = Math.max(0, orderCount - unassignedCount);

  return {
    routeCount: active.length,
    assignedStops,
    assignedOrders: assignedOrderEstimate,
    unassignedCount,
    lateStops,
    totalDistanceKm,
    avgUtilizationPct,
    minUtilizationPct,
    maxUtilizationPct,
    utilizationSpreadPct,
    balanceMoves: Math.max(0, Math.floor(num(input.balanceMoves, 0))),
    solveMs,
  };
}
