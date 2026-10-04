import { useEffect, useMemo, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { chartFonts, useChartTheme } from "./chartTheme";
import {
  downloadAnalyzeReportExcel,
  buildUserFleetGroupMap,
  fetchAnalyzeSummary,
  fetchCostDashboard,
  fetchMaintStatusSummary,
  formatServiceDuration,
  type AnalyzeSummary,
  type CostDashboard,
} from "../lib/maintenance";
import { MaintenanceServiceResultsPanel } from "./MaintenanceServiceResultsPanel";
import { MaintenanceScheduleCharts } from "./MaintenanceScheduleCharts";
import type { FleetGroupRef } from "../lib/maintenance";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip);

type Props = {
  fleetUserIds?: number[];
  groups?: FleetGroupRef[];
  excelOk?: boolean;
  onOpenEvent?: (id: string) => void;
  onJumpToJobs?: (opts: {
    status?: "open" | "done" | "approved" | "in_progress";
    health?: "upcoming" | "due" | "overdue" | "";
  }) => void;
};

function pct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

export function MaintenanceAnalyzeReport({
  fleetUserIds = [],
  groups = [],
  excelOk = true,
  onOpenEvent,
  onJumpToJobs,
}: Props) {
  const theme = useChartTheme();
  const [days, setDays] = useState(90);
  const [group, setGroup] = useState("");
  const [data, setData] = useState<AnalyzeSummary | null>(null);
  const [cost, setCost] = useState<CostDashboard | null>(null);
  const [fleet, setFleet] = useState<{ vehicles: number; withOpen: number; withOverdue: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    void Promise.all([
      fetchAnalyzeSummary(days, ac.signal),
      fetchCostDashboard({ days, group: group || undefined }, ac.signal),
    ])
      .then(([summary, costDash]) => {
        if (ac.signal.aborted) return;
        setData(summary);
        setCost(costDash);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [days, group]);

  useEffect(() => {
    if (!fleetUserIds.length) {
      setFleet(null);
      return;
    }
    const ac = new AbortController();
    void fetchMaintStatusSummary(fleetUserIds, ac.signal)
      .then((byUserId) => {
        if (ac.signal.aborted) return;
        let withOpen = 0;
        let withOverdue = 0;
        for (const id of fleetUserIds) {
          const cell = byUserId[String(id)];
          if (!cell?.status) continue;
          if (cell.status === "due" || cell.status === "in_progress") {
            withOpen += 1;
            if (cell.health === "overdue") withOverdue += 1;
          }
        }
        setFleet({ vehicles: fleetUserIds.length, withOpen, withOverdue });
      })
      .catch(() => {
        if (!ac.signal.aborted) setFleet(null);
      });
    return () => ac.abort();
  }, [fleetUserIds]);

  const assigneeBar = useMemo(() => {
    const rows = (data?.byAssignee || []).filter((a) => a.open > 0 || a.done > 0 || a.approved > 0).slice(0, 12);
    const chart: ChartData<"bar"> = {
      labels: rows.map((a) => a.name),
      datasets: [
        {
          label: "Open",
          data: rows.map((a) => a.open),
          backgroundColor: theme.due,
          borderRadius: 3,
        },
        {
          label: "Done",
          data: rows.map((a) => a.done),
          backgroundColor: theme.upcoming,
          borderRadius: 3,
        },
        {
          label: "Approved",
          data: rows.map((a) => a.approved),
          backgroundColor: theme.ok,
          borderRadius: 3,
        },
      ],
    };
    return { rows, chart };
  }, [data, theme]);

  const agingData: ChartData<"bar"> = {
    labels: data?.aging.map((a) => a.label) || [],
    datasets: [
      {
        label: "Open jobs",
        data: data?.aging.map((a) => a.count) || [],
        backgroundColor: theme.aging,
        borderRadius: 3,
        maxBarThickness: 40,
      },
    ],
  };

  const vehicleRows = (cost?.byVehicle || []).slice(0, 12);
  const userFleetGroups = useMemo(() => buildUserFleetGroupMap(groups), [groups]);
  const vehicleData: ChartData<"bar"> = {
    labels: vehicleRows.map((v) => v.label),
    datasets: [
      {
        label: "Cost",
        data: vehicleRows.map((v) => v.cost),
        backgroundColor: theme.cost,
        borderRadius: 3,
      },
      {
        label: "Price",
        data: vehicleRows.map((v) => v.price),
        backgroundColor: theme.price,
        borderRadius: 3,
      },
    ],
  };

  const dayLabels = cost?.byDay.map((d) => d.day.slice(5)) || [];
  const costLine: ChartData<"line"> = {
    labels: dayLabels,
    datasets: [
      {
        label: "Cost",
        data: cost?.byDay.map((d) => d.cost) || [],
        borderColor: theme.costLine,
        backgroundColor: theme.costFill,
        tension: 0.25,
        pointRadius: 2,
      },
      {
        label: "Price",
        data: cost?.byDay.map((d) => d.price) || [],
        borderColor: theme.priceLine,
        backgroundColor: theme.priceFill,
        tension: 0.25,
        pointRadius: 2,
      },
    ],
  };
  const lineOpts: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom" }, tooltip: theme.tooltip },
    scales: {
      x: { ticks: { color: theme.inkSoft, font: { family: chartFonts.ui, size: 10 } }, grid: { display: false } },
      y: { beginAtZero: true, ticks: theme.ticks },
    },
  };

  const barOpts: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom" }, tooltip: theme.tooltip },
    scales: {
      x: { grid: { display: false }, ticks: { color: theme.inkSoft, maxRotation: 45, minRotation: 0 } },
      y: { beginAtZero: true, ticks: theme.ticks },
    },
  };

  const marginPct =
    cost && cost.totals.price > 0 ? cost.totals.margin / cost.totals.price : null;

  return (
    <section className="maintenance-analyze-report">
      <div className="maintenance-cost-head">
        <div>
          <h2>Analyze report</h2>
          <p className="muted">
            Workload, schedule risk, assignment, approval funnel, and approved commercial performance.
          </p>
        </div>
        <div className="maintenance-cost-filters">
          <label>
            Days
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={30}>30</option>
              <option value={90}>90</option>
              <option value={180}>180</option>
              <option value={365}>365</option>
            </select>
          </label>
          <label>
            Group (catalog)
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">All</option>
              <option value="part">Part</option>
              <option value="service">Service</option>
              <option value="other">Others</option>
            </select>
          </label>
          {excelOk && data ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => downloadAnalyzeReportExcel(data, fleet)}
            >
              Export Excel
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading && !data ? <p className="muted">Loading…</p> : null}

      {data ? (
        <>
          <div className="maint-cost-tiles maint-analyze-kpis">
            <button type="button" className="maint-dash-tile" onClick={() => onJumpToJobs?.({ status: "open" })}>
              <span>Open</span>
              <strong>{data.workflow.open}</strong>
            </button>
            <button
              type="button"
              className="maint-dash-tile maint-health-upcoming"
              onClick={() => onJumpToJobs?.({ health: "upcoming" })}
            >
              <span>Upcoming</span>
              <strong>{data.schedule.upcoming}</strong>
            </button>
            <button
              type="button"
              className="maint-dash-tile maint-health-due"
              onClick={() => onJumpToJobs?.({ health: "due" })}
            >
              <span>Due</span>
              <strong>{data.schedule.due}</strong>
            </button>
            <button
              type="button"
              className="maint-dash-tile maint-health-overdue"
              onClick={() => onJumpToJobs?.({ health: "overdue" })}
            >
              <span>Overdue</span>
              <strong>{data.schedule.overdue}</strong>
            </button>
            <button
              type="button"
              className="maint-dash-tile maint-health-completed"
              onClick={() => onJumpToJobs?.({ status: "done" })}
            >
              <span>Awaiting approve</span>
              <strong>{data.workflow.done}</strong>
            </button>
            <button type="button" className="maint-dash-tile" onClick={() => onJumpToJobs?.({ status: "approved" })}>
              <span>Approved ({days}d)</span>
              <strong>{data.approved.jobs}</strong>
            </button>
            <div className="maint-dash-tile maint-dash-stat">
              <span>Avg service</span>
              <strong>{formatServiceDuration(data.approved.avgServiceMinutes)}</strong>
            </div>
            <div className="maint-dash-tile maint-dash-stat">
              <span>Approved margin</span>
              <strong>{data.approved.margin.toFixed(0)}</strong>
              <span className="muted maint-dash-sub">
                {data.approved.price.toFixed(0)} − {data.approved.cost.toFixed(0)}
              </span>
            </div>
          </div>

          <div className="maint-analyze-strip">
            <div>
              <span className="muted">Assigned / unassigned (open)</span>
              <strong>
                {data.assignment.openAssigned} / {data.assignment.openUnassigned}
              </strong>
            </div>
            <div>
              <span className="muted">Unassigned follow-ups</span>
              <strong>{data.assignment.unassignedFollowUps}</strong>
            </div>
            <div>
              <span className="muted">Pipeline (done, not locked)</span>
              <strong>
                {data.pipeline.jobs} jobs · est. {data.pipeline.price.toFixed(0)}
              </strong>
            </div>
            <div>
              <span className="muted">Reminders open</span>
              <strong>{data.reminders.openTotal}</strong>
              <span className="muted maint-dash-sub">
                soon {data.reminders.openByKind.due_soon} · overdue {data.reminders.openByKind.overdue} · next{" "}
                {data.reminders.openByKind.next_due} · assigned {data.reminders.openByKind.assigned}
              </span>
            </div>
            {fleet ? (
              <div>
                <span className="muted">Fleet coverage</span>
                <strong>
                  {pct(fleet.vehicles ? fleet.withOpen / fleet.vehicles : null)} open ·{" "}
                  {pct(fleet.vehicles ? fleet.withOverdue / fleet.vehicles : null)} overdue
                </strong>
                <span className="muted maint-dash-sub">
                  {fleet.withOpen}/{fleet.vehicles} open · {fleet.withOverdue} overdue
                </span>
              </div>
            ) : null}
          </div>

          <MaintenanceScheduleCharts
            summary={{
              upcoming: data.schedule.upcoming,
              due: data.schedule.due,
              overdue: data.schedule.overdue,
              completed: data.workflow.done,
              approved: data.workflow.approved,
              awaitingApprove: data.workflow.done,
              ok: data.schedule.ok,
              none: data.schedule.none,
              open: data.schedule.open,
              avgServiceMinutes: data.approved.avgServiceMinutes,
            }}
            healthBars={data.healthBars}
            timeline={data.timeline}
            onSelectHealth={(key) => onJumpToJobs?.({ health: key || "" })}
          />

          <div className="maint-cost-charts">
            <div className="maint-cost-chart">
              <h3>Open job aging</h3>
              <div className="maint-chart-frame">
                <Bar data={agingData} options={{ ...barOpts, plugins: { legend: { display: false }, tooltip: theme.tooltip } }} />
              </div>
            </div>
            <div className="maint-cost-chart">
              <h3>Assignee workload</h3>
              <div className="maint-chart-frame">
                {assigneeBar.rows.length ? (
                  <Bar data={assigneeBar.chart} options={barOpts} />
                ) : (
                  <p className="muted">No assignee activity in range.</p>
                )}
              </div>
            </div>
          </div>

          <div className="maint-analyze-quality">
            <h3>Quality ({days}d closed)</h3>
            <div className="maint-cost-tiles">
              <div className="maint-dash-tile maint-dash-stat">
                <span>Photo complete</span>
                <strong>{pct(data.quality.photoRate)}</strong>
                <span className="muted maint-dash-sub">
                  {data.quality.withPhotos}/{data.quality.closedInPeriod}
                </span>
              </div>
              <div className="maint-dash-tile maint-dash-stat">
                <span>Lines complete</span>
                <strong>{pct(data.quality.lineRate)}</strong>
                <span className="muted maint-dash-sub">
                  {data.quality.withLines}/{data.quality.closedInPeriod}
                </span>
              </div>
              <div className="maint-dash-tile maint-dash-stat">
                <span>Acks / send errors</span>
                <strong>
                  {data.reminders.ackedInPeriod} / {data.reminders.sendErrors}
                </strong>
              </div>
              <div className="maint-dash-tile maint-dash-stat">
                <span>In progress / skipped</span>
                <strong>
                  {data.workflow.in_progress} / {data.workflow.skipped}
                </strong>
              </div>
            </div>
          </div>

          {cost ? (
            <div className="maint-analyze-commercial">
              <div className="maintenance-cost-head">
                <div>
                  <h3>Approved commercial</h3>
                  <p className="muted">Official price / cost / margin from Approved jobs only.</p>
                </div>
              </div>
              <div className="maint-cost-tiles">
                <div className="maint-dash-tile">
                  <span>Jobs</span>
                  <strong>{cost.totals.jobs}</strong>
                </div>
                <div className="maint-dash-tile">
                  <span>Price Σ</span>
                  <strong>{cost.totals.price.toFixed(0)}</strong>
                </div>
                <div className="maint-dash-tile">
                  <span>Cost Σ</span>
                  <strong>{cost.totals.cost.toFixed(0)}</strong>
                </div>
                <div className="maint-dash-tile">
                  <span>Margin</span>
                  <strong>
                    {cost.totals.margin.toFixed(0)}
                    {marginPct != null ? ` (${pct(marginPct)})` : ""}
                  </strong>
                </div>
              </div>
              <div className="maint-cost-charts">
                <div className="maint-cost-chart">
                  <h3>Cost / price over time</h3>
                  <div className="maint-chart-frame">
                    <Line data={costLine} options={lineOpts} />
                  </div>
                </div>
                <div className="maint-cost-chart">
                  <h3>By vehicle</h3>
                  <div className="maint-chart-frame">
                    {vehicleRows.length ? (
                      <Bar data={vehicleData} options={barOpts} />
                    ) : (
                      <p className="muted">No approved vehicle totals in range.</p>
                    )}
                  </div>
                </div>
              </div>
              {vehicleRows.length ? (
                <div className="table-wrap">
                  <h3>Approved by vehicle</h3>
                  <table className="metrics">
                    <thead>
                      <tr>
                        <th>Vehicle</th>
                        <th>Fleet group</th>
                        <th className="num">Jobs</th>
                        <th className="num">Price</th>
                        <th className="num">Cost</th>
                        <th className="num">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(cost.byVehicle || []).slice(0, 25).map((v) => {
                        const fg =
                          v.userId != null ? userFleetGroups.get(v.userId) || [] : [];
                        return (
                          <tr key={`${v.userId ?? v.label}`}>
                            <td>{v.label}</td>
                            <td>{fg.length ? fg.join(", ") : "—"}</td>
                            <td className="num">{v.count}</td>
                            <td className="num">{v.price.toFixed(0)}</td>
                            <td className="num">{v.cost.toFixed(0)}</td>
                            <td className="num">{(v.price - v.cost).toFixed(0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {cost.topItems.length ? (
                <div className="maint-cost-top">
                  <h3>Top catalog items</h3>
                  <ul>
                    {cost.topItems.slice(0, 8).map((it) => (
                      <li key={`${it.kind}-${it.name}`}>
                        <strong>{it.name}</strong>
                        <span className="muted">
                          {it.kind} · qty {it.qty} · cost {it.cost.toFixed(0)} · price {it.price.toFixed(0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="table-wrap">
                <table className="metrics">
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>Fleet group</th>
                      <th>Title</th>
                      <th>Approved</th>
                      <th className="num">Price</th>
                      <th className="num">Cost</th>
                      <th className="num">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cost.table.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="muted">
                          No approved jobs in this range.
                        </td>
                      </tr>
                    ) : (
                      cost.table.slice(0, 40).map((row) => {
                        const fg =
                          row.armadaUserId != null
                            ? userFleetGroups.get(row.armadaUserId) || []
                            : [];
                        return (
                        <tr key={row.id}>
                          <td>{row.vehicle}</td>
                          <td>{fg.length ? fg.join(", ") : "—"}</td>
                          <td>
                            {onOpenEvent ? (
                              <button type="button" className="btn-link" onClick={() => onOpenEvent(row.id)}>
                                {row.title || "Job"}
                              </button>
                            ) : (
                              row.title
                            )}
                          </td>
                          <td>{row.approvedAt ? String(row.approvedAt).slice(0, 10) : "—"}</td>
                          <td className="num">{row.priceTotal == null ? "—" : row.priceTotal.toFixed(0)}</td>
                          <td className="num">{row.costTotal == null ? "—" : row.costTotal.toFixed(0)}</td>
                          <td className="num">{row.margin == null ? "—" : row.margin.toFixed(0)}</td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <MaintenanceServiceResultsPanel
            days={days}
            groups={groups}
            excelOk={excelOk}
            onOpenEvent={onOpenEvent}
          />

          {assigneeBar.rows.length ? (
            <div className="table-wrap">
              <h3>Technicians</h3>
              <table className="metrics">
                <thead>
                  <tr>
                    <th>Assignee</th>
                    <th className="num">Open</th>
                    <th className="num">Done</th>
                    <th className="num">Approved</th>
                    <th>Avg service</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byAssignee.map((a) => (
                    <tr key={a.id || a.name}>
                      <td>{a.name}</td>
                      <td className="num">{a.open}</td>
                      <td className="num">{a.done}</td>
                      <td className="num">{a.approved}</td>
                      <td>{formatServiceDuration(a.avgMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
