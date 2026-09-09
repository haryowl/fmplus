import { useEffect, useMemo, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { axisTicks, baseTooltip } from "./chartTheme";
import {
  downloadServiceResultsExcel,
  enrichServiceResultsWithFleetGroups,
  fetchServiceResults,
  formatServiceDuration,
  SERVICE_STATUS_LABELS,
  type FleetGroupRef,
  type ServiceResultsStatus,
} from "../lib/maintenance";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

type Props = {
  days: number;
  groups: FleetGroupRef[];
  excelOk?: boolean;
  onOpenEvent?: (id: string) => void;
};

type GroupBy = "jobs" | "vehicle" | "fleet" | "item";

export function MaintenanceServiceResultsPanel({
  days,
  groups,
  excelOk = true,
  onOpenEvent,
}: Props) {
  const [status, setStatus] = useState<ServiceResultsStatus>("all");
  const [catalogGroup, setCatalogGroup] = useState("");
  const [fleetGroupId, setFleetGroupId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("jobs");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState<Awaited<ReturnType<typeof fetchServiceResults>> | null>(null);
  const [fleetGroupOptions, setFleetGroupOptions] = useState<
    { id: number; name: string; jobVehicles: number }[]
  >([]);

  const fleetFilterUserIds = useMemo(() => {
    if (!fleetGroupId) return undefined;
    const g = groups.find((x) => String(x.id) === fleetGroupId);
    return g?.usersIds?.length ? g.usersIds : undefined;
  }, [fleetGroupId, groups]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    void fetchServiceResults(
      {
        days,
        status,
        catalogGroup: catalogGroup || undefined,
        q: qApplied || undefined,
        userId: vehicleId ? Number(vehicleId) : undefined,
        userIds: !vehicleId && fleetFilterUserIds ? fleetFilterUserIds : undefined,
      },
      ac.signal,
    )
      .then((d) => {
        if (!ac.signal.aborted) setRaw(d);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [days, status, catalogGroup, qApplied, vehicleId, fleetFilterUserIds]);

  const enriched = useMemo(
    () => (raw ? enrichServiceResultsWithFleetGroups(raw, groups) : null),
    [raw, groups],
  );

  useEffect(() => {
    if (enriched && !fleetGroupId) {
      setFleetGroupOptions(enriched.fleetGroupOptions);
    }
  }, [enriched, fleetGroupId]);

  const vehicleOptions = useMemo(() => {
    if (!enriched) return [];
    return enriched.byVehicle
      .filter((v) => v.userId != null)
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [enriched]);

  const barOpts: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom" }, tooltip: baseTooltip },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#5e584f", maxRotation: 45 } },
      y: { beginAtZero: true, ticks: axisTicks },
    },
  };

  const fleetChart: ChartData<"bar"> = {
    labels: (enriched?.byFleetGroup || []).slice(0, 12).map((g) => g.name),
    datasets: [
      {
        label: "Cost",
        data: (enriched?.byFleetGroup || []).slice(0, 12).map((g) => g.cost),
        backgroundColor: "#c9a882",
        borderRadius: 3,
      },
      {
        label: "Price",
        data: (enriched?.byFleetGroup || []).slice(0, 12).map((g) => g.price),
        backgroundColor: "#8a9a7a",
        borderRadius: 3,
      },
    ],
  };

  const vehicleChart: ChartData<"bar"> = {
    labels: (enriched?.byVehicle || []).slice(0, 12).map((v) => v.label),
    datasets: [
      {
        label: "Cost",
        data: (enriched?.byVehicle || []).slice(0, 12).map((v) => v.cost),
        backgroundColor: "#c9a882",
        borderRadius: 3,
      },
      {
        label: "Price",
        data: (enriched?.byVehicle || []).slice(0, 12).map((v) => v.price),
        backgroundColor: "#8a9a7a",
        borderRadius: 3,
      },
    ],
  };

  const itemChart: ChartData<"bar"> = {
    labels: (enriched?.byItem || []).slice(0, 12).map((i) => i.name),
    datasets: [
      {
        label: "Cost",
        data: (enriched?.byItem || []).slice(0, 12).map((i) => i.cost),
        backgroundColor: "#c9a882",
        borderRadius: 3,
      },
      {
        label: "Price",
        data: (enriched?.byItem || []).slice(0, 12).map((i) => i.price),
        backgroundColor: "#8a9a7a",
        borderRadius: 3,
      },
    ],
  };

  return (
    <div className="maint-service-results">
      <div className="maintenance-cost-head">
        <div>
          <h3>Service results</h3>
          <p className="muted">
            Rank cost/price by vehicle, fleet group, and part/service. Outstanding = open + done awaiting
            approve. Approved amounts are locked money; other statuses are estimates when lines exist.
          </p>
        </div>
        {excelOk && enriched ? (
          <button type="button" className="btn-ghost" onClick={() => downloadServiceResultsExcel(enriched)}>
            Export results
          </button>
        ) : null}
      </div>

      <div className="maintenance-cost-filters maint-results-filters">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as ServiceResultsStatus)}>
            <option value="all">All (excl. skipped)</option>
            <option value="outstanding">Outstanding (open + done)</option>
            <option value="open">Open only</option>
            <option value="done">Done awaiting approve</option>
            <option value="approved">Approved (locked)</option>
          </select>
        </label>
        <label>
          Fleet group
          <select
            value={fleetGroupId}
            onChange={(e) => {
              setFleetGroupId(e.target.value);
              setVehicleId("");
            }}
          >
            <option value="">All with jobs</option>
            {fleetGroupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.jobVehicles})
              </option>
            ))}
          </select>
        </label>
        <label>
          Vehicle
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">All with jobs</option>
            {vehicleOptions.map((v) => (
              <option key={v.userId!} value={v.userId!}>
                {v.label}
                {v.fleetGroups?.length ? ` · ${v.fleetGroups.join(", ")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Catalog
          <select value={catalogGroup} onChange={(e) => setCatalogGroup(e.target.value)}>
            <option value="">All kinds</option>
            <option value="part">Part</option>
            <option value="service">Service</option>
            <option value="other">Others</option>
          </select>
        </label>
        <label>
          Item contains
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQApplied(q.trim());
            }}
            placeholder="Filter part/service name"
          />
        </label>
        <button type="button" className="btn-secondary" onClick={() => setQApplied(q.trim())}>
          Apply
        </button>
        <label>
          View
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="jobs">Job detail</option>
            <option value="vehicle">By vehicle</option>
            <option value="fleet">By fleet group</option>
            <option value="item">By part/service</option>
          </select>
        </label>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading && !enriched ? <p className="muted">Loading service results…</p> : null}

      {enriched ? (
        <>
          <div className="maint-cost-tiles">
            <div className="maint-dash-tile maint-dash-stat">
              <span>Jobs</span>
              <strong>{enriched.totals.jobs}</strong>
            </div>
            <div className="maint-dash-tile maint-dash-stat">
              <span>Outstanding</span>
              <strong>{enriched.totals.outstandingJobs}</strong>
              <span className="muted maint-dash-sub">
                open {enriched.totals.openJobs} · done {enriched.totals.doneJobs}
              </span>
            </div>
            <div className="maint-dash-tile maint-dash-stat">
              <span>Approved</span>
              <strong>{enriched.totals.approvedJobs}</strong>
            </div>
            <div className="maint-dash-tile maint-dash-stat">
              <span>Price Σ</span>
              <strong>{enriched.totals.price.toFixed(0)}</strong>
            </div>
            <div className="maint-dash-tile maint-dash-stat">
              <span>Cost Σ</span>
              <strong>{enriched.totals.cost.toFixed(0)}</strong>
            </div>
            <div className="maint-dash-tile maint-dash-stat">
              <span>Margin Σ</span>
              <strong>{enriched.totals.margin.toFixed(0)}</strong>
            </div>
          </div>

          {(groupBy === "fleet" || groupBy === "vehicle" || groupBy === "item") && (
            <div className="maint-cost-chart">
              <h3>
                {groupBy === "fleet"
                  ? "Cost / price by fleet group"
                  : groupBy === "vehicle"
                    ? "Cost / price by vehicle"
                    : "Cost / price by part/service"}
              </h3>
              <div className="maint-chart-frame">
                <Bar
                  data={groupBy === "fleet" ? fleetChart : groupBy === "vehicle" ? vehicleChart : itemChart}
                  options={barOpts}
                />
              </div>
            </div>
          )}

          {groupBy === "fleet" ? (
            <div className="table-wrap">
              <table className="metrics">
                <thead>
                  <tr>
                    <th>Fleet group</th>
                    <th className="num">Jobs</th>
                    <th className="num">Price</th>
                    <th className="num">Cost</th>
                    <th className="num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.byFleetGroup.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No fleet groups with jobs in this filter.
                      </td>
                    </tr>
                  ) : (
                    enriched.byFleetGroup.map((g) => (
                      <tr key={`${g.id ?? "x"}-${g.name}`}>
                        <td>{g.name}</td>
                        <td className="num">{g.count}</td>
                        <td className="num">{g.price.toFixed(0)}</td>
                        <td className="num">{g.cost.toFixed(0)}</td>
                        <td className="num">{g.margin.toFixed(0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {groupBy === "vehicle" ? (
            <div className="table-wrap">
              <table className="metrics">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Fleet group</th>
                    <th className="num">Jobs</th>
                    <th className="num">Outstanding</th>
                    <th className="num">Approved</th>
                    <th className="num">Price</th>
                    <th className="num">Cost</th>
                    <th className="num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.byVehicle.map((v) => (
                    <tr key={`${v.userId ?? v.label}`}>
                      <td>{v.label}</td>
                      <td>{v.fleetGroups?.length ? v.fleetGroups.join(", ") : "—"}</td>
                      <td className="num">{v.count}</td>
                      <td className="num">{v.outstanding}</td>
                      <td className="num">{v.approved}</td>
                      <td className="num">{v.price.toFixed(0)}</td>
                      <td className="num">{v.cost.toFixed(0)}</td>
                      <td className="num">{(v.price - v.cost).toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {groupBy === "item" ? (
            <div className="table-wrap">
              <table className="metrics">
                <thead>
                  <tr>
                    <th>Part / service</th>
                    <th>Kind</th>
                    <th className="num">Jobs</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th className="num">Cost</th>
                    <th className="num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.byItem.map((it) => (
                    <tr key={`${it.kind}-${it.name}`}>
                      <td>{it.name}</td>
                      <td>{it.kind}</td>
                      <td className="num">{it.jobs}</td>
                      <td className="num">{it.qty}</td>
                      <td className="num">{it.price.toFixed(0)}</td>
                      <td className="num">{it.cost.toFixed(0)}</td>
                      <td className="num">{it.margin.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {groupBy === "jobs" ? (
            <div className="table-wrap">
              <table className="metrics">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Vehicle</th>
                    <th>Fleet group</th>
                    <th>Title</th>
                    <th>Items</th>
                    <th>Service</th>
                    <th className="num">Price</th>
                    <th className="num">Cost</th>
                    <th className="num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="muted">
                        No jobs match this filter.
                      </td>
                    </tr>
                  ) : (
                    enriched.rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.date ? String(row.date).slice(0, 10) : "—"}</td>
                        <td>
                          {SERVICE_STATUS_LABELS[row.status] || row.status}
                          {!row.moneyLocked && (row.priceTotal != null || row.costTotal != null) ? (
                            <span className="muted"> · est.</span>
                          ) : null}
                        </td>
                        <td>{row.vehicle}</td>
                        <td>{row.fleetGroups?.length ? row.fleetGroups.join(", ") : "—"}</td>
                        <td>
                          {onOpenEvent ? (
                            <button type="button" className="btn-link" onClick={() => onOpenEvent(row.id)}>
                              {row.title || "Job"}
                            </button>
                          ) : (
                            row.title
                          )}
                        </td>
                        <td className="muted">
                          {row.items.length
                            ? row.items
                                .slice(0, 3)
                                .map((i) => i.name)
                                .join(", ") + (row.items.length > 3 ? "…" : "")
                            : "—"}
                        </td>
                        <td>{formatServiceDuration(row.serviceDurationMinutes)}</td>
                        <td className="num">{row.priceTotal == null ? "—" : row.priceTotal.toFixed(0)}</td>
                        <td className="num">{row.costTotal == null ? "—" : row.costTotal.toFixed(0)}</td>
                        <td className="num">{row.margin == null ? "—" : row.margin.toFixed(0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {enriched.totals.shown < enriched.totals.jobs ? (
                <p className="muted">
                  Showing {enriched.totals.shown} of {enriched.totals.jobs} jobs (export for full pivot
                  aggregates).
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
