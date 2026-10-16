import type { DispatchPlanDayResult } from "../lib/dispatch";
import { planUnassignedReasonLabel } from "../lib/dispatchPlanBalance";

type Props = {
  planPreview: DispatchPlanDayResult;
};

/** Auto-plan day preview summary: routes, balance goals, unassigned. */
export function DispatchPlanDayPreview({ planPreview }: Props) {
  const kpis = planPreview.kpis;
  return (
    <div className="dispatch-plan-preview">
      <p className="dispatch-eyebrow">
        Preview · {planPreview.engine}
        {planPreview.warning ? ` · ${planPreview.warning}` : ""}
      </p>
      <p className="dispatch-search-hint">
        {planPreview.routes.length} route(s) · {planPreview.orderCount} orders considered ·{" "}
        {planPreview.unassigned.length} unassigned
        {Array.isArray(planPreview.balanceGoals)
          ? ` · Balance: ${
              planPreview.balanceGoals.length
                ? `${planPreview.balanceGoals.join(" · ")}${
                    planPreview.balanceMoves ? ` · ${planPreview.balanceMoves} moves` : ""
                  }`
                : "off"
            }`
          : planPreview.balanceMoves
            ? ` · ${planPreview.balanceMoves} balance move(s)`
            : ""}
        {planPreview.depots?.length ? ` · ${planPreview.depots.length} depot(s)` : ""}
        {planPreview.multiTripMode && planPreview.multiTripMode !== "off"
          ? ` · multi-trip ${planPreview.multiTripMode}`
          : ""}
      </p>
      {kpis ? (
        <ul className="dispatch-plan-kpis" aria-label="Plan quality">
          <li>
            <em>Assigned</em>
            <strong>
              {kpis.assignedOrders}/{planPreview.orderCount}
            </strong>
          </li>
          <li>
            <em>Unassigned</em>
            <strong className={kpis.unassignedCount > 0 ? "is-warn" : undefined}>
              {kpis.unassignedCount}
            </strong>
          </li>
          <li>
            <em>Late stops</em>
            <strong className={kpis.lateStops > 0 ? "is-warn" : undefined}>{kpis.lateStops}</strong>
          </li>
          <li>
            <em>Distance</em>
            <strong>{kpis.totalDistanceKm} km</strong>
          </li>
          <li>
            <em>Fill avg</em>
            <strong>{kpis.avgUtilizationPct}%</strong>
          </li>
          <li>
            <em>Fill spread</em>
            <strong
              className={kpis.utilizationSpreadPct >= 25 ? "is-warn" : undefined}
              title={`${kpis.minUtilizationPct}% – ${kpis.maxUtilizationPct}%`}
            >
              {kpis.utilizationSpreadPct} pp
            </strong>
          </li>
          {kpis.solveMs != null ? (
            <li>
              <em>Solve</em>
              <strong>{kpis.solveMs} ms</strong>
            </li>
          ) : null}
        </ul>
      ) : null}
      <ul className="dispatch-plan-routes">
        {planPreview.routes.map((r) => {
          const tripIndex = Number(r.meta?.tripIndex) || 1;
          return (
            <li key={r.key}>
              <strong>
                {r.label}
                {tripIndex > 1 ? (
                  <em className="dispatch-live-pill tone-in_transit"> trip {tripIndex}</em>
                ) : null}
                {r.depotName ? ` · ${r.depotName}` : ""}
              </strong>
              <span>
                {r.orderIds.length} stops · {r.utilizationPct}% · {r.distanceKm} km · {r.volumeUsed}/
                {r.volumeCapacityM3} m³ · {r.weightUsed}/{r.weightCapacityKg} kg
                {r.lateStops ? ` · ${r.lateStops} late` : ""}
              </span>
              {r.stops && r.stops.length > 0 ? (
                <ol className="dispatch-plan-stop-etas">
                  {r.pathMode === "sequence" && r.routeStart ? (
                    <li key={`${r.key}-start`}>Start · {r.routeStart.label}</li>
                  ) : null}
                  {r.stops.map((s, idx) => (
                    <li
                      key={`${r.key}-${s.orderId || idx}`}
                      className={s.late ? "is-late" : undefined}
                    >
                      {s.arriveAt} · {s.label || s.orderId || `Stop ${idx + 1}`}
                      {s.serviceMinutes != null ? ` · ${s.serviceMinutes} min stop` : ""}
                      {s.windowEnd ? ` (≤${s.windowEnd})` : ""}
                      {s.late ? " · late" : ""}
                    </li>
                  ))}
                  {r.pathMode === "sequence" && r.routeEnd ? (
                    <li key={`${r.key}-end`}>Return · {r.routeEnd.label}</li>
                  ) : null}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ul>
      {planPreview.unassigned.length > 0 ? (
        <div className="dispatch-plan-unassigned">
          <p className="dispatch-eyebrow">Unassigned · {planPreview.unassigned.length}</p>
          <ul>
            {planPreview.unassigned.slice(0, 12).map((u) => {
              const depotName =
                u.depotId && planPreview.depots
                  ? planPreview.depots.find((d) => d.id === u.depotId)?.name
                  : null;
              return (
                <li key={u.orderId}>
                  <strong>{u.label || u.orderId}</strong>
                  <span>
                    {planUnassignedReasonLabel(u.reason)}
                    {depotName ? ` · ${depotName}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          {planPreview.unassigned.length > 12 ? (
            <p className="dispatch-search-hint">+{planPreview.unassigned.length - 12} more</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
