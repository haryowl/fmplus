import { useEffect, useState } from "react";
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
import { axisTicks, baseTooltip, chartFonts } from "./chartTheme";
import {
  fetchCostDashboard,
  formatServiceDuration,
  type CostDashboard,
} from "../lib/maintenance";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip);

type Props = {
  onOpenEvent?: (id: string) => void;
};

export function MaintenanceCostDashboard({ onOpenEvent }: Props) {
  const [days, setDays] = useState(90);
  const [group, setGroup] = useState("");
  const [data, setData] = useState<CostDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    void fetchCostDashboard({ days, group: group || undefined }, ac.signal)
      .then((d) => {
        if (!ac.signal.aborted) setData(d);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [days, group]);

  const dayLabels = data?.byDay.map((d) => d.day.slice(5)) || [];
  const lineData: ChartData<"line"> = {
    labels: dayLabels,
    datasets: [
      {
        label: "Cost",
        data: data?.byDay.map((d) => d.cost) || [],
        borderColor: "#8a6a4a",
        backgroundColor: "rgba(138,106,74,0.12)",
        tension: 0.25,
        pointRadius: 2,
      },
      {
        label: "Price",
        data: data?.byDay.map((d) => d.price) || [],
        borderColor: "#5a7a6a",
        backgroundColor: "rgba(90,122,106,0.1)",
        tension: 0.25,
        pointRadius: 2,
      },
    ],
  };
  const lineOpts: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom" }, tooltip: baseTooltip },
    scales: {
      x: { ticks: { color: "#5e584f", font: { family: chartFonts.ui, size: 10 } }, grid: { display: false } },
      y: { beginAtZero: true, ticks: axisTicks },
    },
  };

  const groupKeys = ["part", "service", "other"] as const;
  const barData: ChartData<"bar"> = {
    labels: ["Part", "Service", "Others"],
    datasets: [
      {
        label: "Cost",
        data: groupKeys.map((k) => data?.byGroup?.[k]?.cost || 0),
        backgroundColor: "#c9a882",
        borderRadius: 3,
      },
      {
        label: "Price",
        data: groupKeys.map((k) => data?.byGroup?.[k]?.price || 0),
        backgroundColor: "#8a9a7a",
        borderRadius: 3,
      },
    ],
  };

  return (
    <section className="maintenance-cost-dash">
      <div className="maintenance-cost-head">
        <div>
          <h2>Approved cost dashboard</h2>
          <p className="muted">Totals from Approved jobs only (Done awaiting approve is excluded).</p>
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
            Group
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">All</option>
              <option value="part">Part</option>
              <option value="service">Service</option>
              <option value="other">Others</option>
            </select>
          </label>
        </div>
      </div>
      {error ? <div className="banner error">{error}</div> : null}
      {loading && !data ? <p className="muted">Loading…</p> : null}
      {data ? (
        <>
          <div className="maint-cost-tiles">
            <div className="maint-dash-tile">
              <span>Jobs</span>
              <strong>{data.totals.jobs}</strong>
            </div>
            <div className="maint-dash-tile">
              <span>Price Σ</span>
              <strong>{data.totals.price.toFixed(0)}</strong>
            </div>
            <div className="maint-dash-tile">
              <span>Cost Σ</span>
              <strong>{data.totals.cost.toFixed(0)}</strong>
            </div>
            <div className="maint-dash-tile">
              <span>Margin</span>
              <strong>{data.totals.margin.toFixed(0)}</strong>
            </div>
          </div>
          <div className="maint-cost-charts">
            <div className="maint-cost-chart">
              <h3>Cost / price over time</h3>
              <div className="maint-chart-frame">
                <Line data={lineData} options={lineOpts} />
              </div>
            </div>
            <div className="maint-cost-chart">
              <h3>By catalog group</h3>
              <div className="maint-chart-frame">
                <Bar
                  data={barData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: "bottom" }, tooltip: baseTooltip },
                    scales: {
                      x: { grid: { display: false }, ticks: { color: "#5e584f" } },
                      y: { beginAtZero: true, ticks: axisTicks },
                    },
                  }}
                />
              </div>
            </div>
          </div>
          {data.topItems.length ? (
            <div className="maint-cost-top">
              <h3>Top items</h3>
              <ul>
                {data.topItems.slice(0, 8).map((it) => (
                  <li key={it.name}>
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
                  <th>Title</th>
                  <th>Approved</th>
                  <th>Service</th>
                  <th className="num">Price</th>
                  <th className="num">Cost</th>
                  <th className="num">Margin</th>
                </tr>
              </thead>
              <tbody>
                {data.table.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      No approved jobs in this range. Approve completed jobs to populate costs.
                    </td>
                  </tr>
                ) : (
                  data.table.map((row) => (
                    <tr key={row.id}>
                      <td>{row.vehicle}</td>
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
                      <td>{formatServiceDuration(row.serviceDurationMinutes)}</td>
                      <td className="num">{row.priceTotal == null ? "—" : row.priceTotal.toFixed(0)}</td>
                      <td className="num">{row.costTotal == null ? "—" : row.costTotal.toFixed(0)}</td>
                      <td className="num">{row.margin == null ? "—" : row.margin.toFixed(0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
