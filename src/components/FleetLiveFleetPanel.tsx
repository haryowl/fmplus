import { useEffect, useMemo, useState } from "react";
import { FLEET_VEHICLE_CAP } from "../lib/config";
import { compareSnapshots, deltaTone } from "../lib/compare";
import {
  DEVICE_METRICS_MAX_DAYS,
  deviceBehavior,
  deviceNumericId,
  devicePeriodMetrics,
  fetchDeviceTripsForRange,
} from "../lib/deviceMetrics";
import {
  alignedPeriodKeys,
  fleetColor,
  seriesForPeriod,
  totalsToCompare,
  type FleetVehicleRow,
} from "../lib/fleet";
import { formatHours, formatInt, formatLiters } from "../lib/format";
import { movingSharePct } from "../lib/metrics";
import { addDays, todayKeyInOffset } from "../lib/time";
import type { Period } from "../lib/types";
import { useUnitSystem } from "../lib/unitSystem";
import { FleetBarChart } from "./FleetBarChart";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";
import { IcoCalendar, IcoDevice, IcoFleet, IcoHistory, IcoOdo, IcoRank, IcoUtil } from "./fleetLiveIcons";

type Props = {
  devices: FleetTripDeviceOption[];
  timezone: string;
  initialDeviceIds?: string[];
  onOpenFull?: (deviceId: string) => void;
};

const COMPARE_KEEP = new Set(["gps", "ign", "active", "idle", "speed", "fuel"]);

function formatCompare(id: string, n: number, units: ReturnType<typeof useUnitSystem>): string {
  if (id === "active" || id === "idle") return `${formatHours(n)} h`;
  if (id === "speed") return n > 0 ? units.speed(n) : "—";
  if (id === "fuel") return n > 0 ? `${formatLiters(n)} L` : "—";
  return units.distance(n);
}

export function FleetLiveFleetPanel({
  devices,
  timezone,
  initialDeviceIds,
  onOpenFull,
}: Props) {
  const units = useUnitSystem();
  const defaultTo = todayKeyInOffset(timezone);
  const [selected, setSelected] = useState<string[]>(() =>
    (initialDeviceIds?.length ? initialDeviceIds : devices.slice(0, Math.min(4, devices.length)).map((d) => d.deviceId)).slice(
      0,
      FLEET_VEHICLE_CAP,
    ),
  );
  const [dateFrom, setDateFrom] = useState(() => addDays(defaultTo, -6));
  const [dateTo, setDateTo] = useState(defaultTo);
  const [period, setPeriod] = useState<Period>("daily");
  const [vehicles, setVehicles] = useState<FleetVehicleRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [baselineId, setBaselineId] = useState(0);
  const [compareId, setCompareId] = useState(0);

  useEffect(() => {
    setSelected((cur) => {
      const keep = cur.filter((id) => devices.some((d) => d.deviceId === id));
      if (keep.length) return keep;
      return devices.slice(0, Math.min(4, devices.length)).map((d) => d.deviceId);
    });
  }, [devices]);

  const idByNumeric = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of devices) map.set(deviceNumericId(d.deviceId), d.deviceId);
    return map;
  }, [devices]);

  const live = vehicles?.filter((v) => v.hasData) || [];
  const periods = vehicles ? alignedPeriodKeys(vehicles) : [];
  const fleetGps = live.reduce((s, v) => s + v.totals.gps, 0);
  const fleetHours = live.reduce((s, v) => s + v.totals.hours, 0);
  const fleetIdle = live.reduce((s, v) => s + v.totals.idle, 0);
  const movingPct = vehicles ? movingSharePct(fleetHours, fleetIdle) : 0;

  const baseline = live.find((v) => v.userId === baselineId) ?? live[0];
  const compare =
    live.find((v) => v.userId === compareId && v.userId !== baseline?.userId) ??
    live.find((v) => v.userId !== baseline?.userId);
  const compareMetrics =
    baseline && compare
      ? compareSnapshots(totalsToCompare(baseline.totals), totalsToCompare(compare.totals)).filter(
          (m) => COMPARE_KEEP.has(m.id) && (m.a !== 0 || m.b !== 0),
        )
      : [];

  function toggleDevice(id: string) {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= FLEET_VEHICLE_CAP) return cur;
      return [...cur, id];
    });
  }

  async function handleLoad() {
    if (!selected.length) return;
    setLoading(true);
    setError("");
    const total = selected.length;
    let loaded = 0;
    setProgress({ loaded: 0, total });
    try {
      const next: FleetVehicleRow[] = [];
      for (let i = 0; i < selected.length; i += 1) {
        const deviceId = selected[i];
        const meta = devices.find((d) => d.deviceId === deviceId);
        const result = await fetchDeviceTripsForRange({
          deviceId,
          dateFrom,
          dateTo,
          timezone,
        });
        const trips = result.pointCount ? [result.trip] : [];
        const { rows, totals } = devicePeriodMetrics(trips, {
          period,
          dateFrom,
          dateTo,
          timezone,
          minSpeedKmh: meta?.tripMinSpeedKmh,
          tripBreakMin: meta?.tripBreakMin,
        });
        next.push({
          userId: deviceNumericId(deviceId),
          label: meta?.label || deviceId.slice(0, 8),
          color: fleetColor(i),
          rows,
          totals,
          behavior: trips.length
            ? deviceBehavior(trips, totals.gps, { period, dateFrom, dateTo, timezone })
            : null,
          hasData: result.pointCount > 0,
        });
        loaded += 1;
        setProgress({ loaded, total });
      }
      setVehicles(next);
      const withData = next.filter((v) => v.hasData);
      setBaselineId(withData[0]?.userId || 0);
      setCompareId(withData[1]?.userId || withData[0]?.userId || 0);
      if (!withData.length) setError("No Device Source points for the selected devices.");
    } catch (err) {
      setVehicles(null);
      setError(err instanceof Error ? err.message : "Failed to load fleet metrics");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  return (
    <div className="fleet-sec fleet-dash fleet-an">
      <FleetLiveSectionHead
        section="fleet"
        title="Fleet"
        subtitle="Compare Device Source assets — kilometres, hours, and rank."
        badge="DEVICE"
        meta={
          <>
            <IcoHistory />
            {`${selected.length} selected · cap ${FLEET_VEHICLE_CAP} · max ${DEVICE_METRICS_MAX_DAYS} days`}
          </>
        }
        actions={
          <div className="fleet-an-filters">
            <label className="fleet-cc-field fleet-cc-field-ico">
              <span>
                <IcoCalendar /> From
              </span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="fleet-cc-field fleet-cc-field-ico">
              <span>
                <IcoCalendar /> To
              </span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <div className="fleet-an-period" role="tablist" aria-label="Period">
              {(["daily", "weekly", "monthly"] as Period[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={period === item ? "is-active" : ""}
                  onClick={() => setPeriod(item)}
                >
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="fleet-an-go"
              disabled={!selected.length || loading}
              onClick={() => void handleLoad()}
            >
              {loading
                ? progress
                  ? `Loading ${progress.loaded}/${progress.total}`
                  : "Loading…"
                : "Load"}
            </button>
          </div>
        }
      />

      <article className="fleet-dash-card">
        <div className="fleet-dash-card-head">
          <h3>
            <IcoDevice /> Assets
          </h3>
          <span className="muted">
            {selected.length}/{FLEET_VEHICLE_CAP}
          </span>
        </div>
        <div className="fleet-an-picks" role="group" aria-label="Devices to compare">
          {devices.map((d) => {
            const on = selected.includes(d.deviceId);
            return (
              <button
                key={d.deviceId}
                type="button"
                className={`fleet-cc-filter-pill${on ? " is-active" : ""}`}
                aria-pressed={on}
                onClick={() => toggleDevice(d.deviceId)}
              >
                {d.label}
              </button>
            );
          })}
          {!devices.length ? <p className="fleet-dash-empty muted">No tracker devices in this group.</p> : null}
        </div>
      </article>

      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

      <section className="fleet-dash-kpis fleet-an-kpis is-3" aria-label="Fleet KPIs">
        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico">
              <IcoFleet />
            </span>
            <em className="fleet-dash-pill">SET</em>
          </header>
          <span className="fleet-dash-kpi-label">Assets</span>
          <strong>{vehicles ? formatInt(live.length) : "—"}</strong>
          <p className="muted">of {selected.length} selected</p>
        </article>
        <article className="fleet-dash-kpi is-util">
          <header>
            <span className="fleet-dash-kpi-ico is-util">
              <IcoOdo />
            </span>
            <em className="fleet-dash-pill">GPS</em>
          </header>
          <span className="fleet-dash-kpi-label">Combined</span>
          <strong>{vehicles ? units.distance(fleetGps, false) : "—"}</strong>
          <p className="muted">{units.distanceUnit} · Device Source</p>
        </article>
        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico is-fuel">
              <IcoUtil />
            </span>
            <em className={`fleet-dash-pill${vehicles ? " is-ok" : ""}`}>
              {vehicles ? `${movingPct.toFixed(0)}%` : "HRS"}
            </em>
          </header>
          <span className="fleet-dash-kpi-label">Active</span>
          <strong>{vehicles ? formatHours(fleetHours) : "—"}</strong>
          <p className="muted">{vehicles ? "moving share of engine-on" : "hours"}</p>
        </article>
      </section>

      {!live.length ? (
        <article className="fleet-dash-card fleet-an-empty">
          <h3>{loading ? "Loading device days…" : "Select assets and load"}</h3>
          <p>Tick up to {FLEET_VEHICLE_CAP} tracker devices, then load the same range.</p>
        </article>
      ) : (
        <>
          <div className="fleet-dash-mid">
            <article className="fleet-dash-card">
              <div className="fleet-dash-card-head">
                <h3>
                  <IcoOdo /> Distance by asset
                </h3>
              </div>
              <FleetBarChart
                labels={live.map((v) => v.label)}
                series={[{ label: "GPS km", data: live.map((v) => v.totals.gps), color: live[0]?.color }]}
                unit="km"
                yTitle="Distance (km)"
              />
            </article>
            <article className="fleet-dash-card">
              <div className="fleet-dash-card-head">
                <h3>
                  {periods.length ? (
                    <>
                      <IcoHistory /> Over time
                    </>
                  ) : (
                    <>
                      <IcoUtil /> Utilization
                    </>
                  )}
                </h3>
              </div>
              {periods.length ? (
                <FleetBarChart
                  type="line"
                  labels={periods.map((p) => p.label)}
                  series={seriesForPeriod(live, periods, (row) => row.gpsDistanceKm).map((data, i) => ({
                    label: live[i].label,
                    color: live[i].color,
                    data,
                  }))}
                  unit="km"
                  yTitle="GPS km"
                />
              ) : (
                <FleetBarChart
                  labels={live.map((v) => v.label)}
                  stacked
                  series={[
                    { label: "Active", data: live.map((v) => v.totals.hours), color: live[0]?.color || "#0b6b62" },
                    { label: "Idle", data: live.map((v) => v.totals.idle), color: "#c47d3a" },
                  ]}
                  unit="h"
                  yTitle="Hours"
                />
              )}
            </article>
          </div>
          <div className={periods.length ? "fleet-dash-mid" : undefined}>
            {periods.length ? (
              <article className="fleet-dash-card">
                <div className="fleet-dash-card-head">
                  <h3>
                    <IcoUtil /> Utilization
                  </h3>
                </div>
                <FleetBarChart
                  labels={live.map((v) => v.label)}
                  stacked
                  series={[
                    { label: "Active", data: live.map((v) => v.totals.hours), color: live[0]?.color || "#0b6b62" },
                    { label: "Idle", data: live.map((v) => v.totals.idle), color: "#c47d3a" },
                  ]}
                  unit="h"
                  yTitle="Hours"
                />
              </article>
            ) : null}
            <article className="fleet-dash-card">
              <div className="fleet-dash-card-head">
                <h3>
                  <IcoRank /> Rank
                </h3>
              </div>
              <div className="fleet-rank-table-wrap">
                <table className="fleet-rank-table">
                  <thead>
                    <tr>
                      <th className="fleet-rank-pos">#</th>
                      <th>Asset</th>
                      <th>GPS</th>
                      <th>Active</th>
                      <th>Idle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...live]
                      .sort((a, b) => b.totals.gps - a.totals.gps)
                      .map((v, i) => {
                        const engine = v.totals.hours + v.totals.idle;
                        const idlePct = engine > 0 ? (v.totals.idle / engine) * 100 : 0;
                        const deviceId = idByNumeric.get(v.userId) || "";
                        return (
                          <tr key={v.userId}>
                            <td className="fleet-rank-pos">{i + 1}</td>
                            <td>
                              {onOpenFull && deviceId ? (
                                <button
                                  type="button"
                                  className="fleet-an-link"
                                  onClick={() => onOpenFull(deviceId)}
                                >
                                  {v.label}
                                </button>
                              ) : (
                                v.label
                              )}
                            </td>
                            <td>{units.distance(v.totals.gps, false)}</td>
                            <td>{formatHours(v.totals.hours)}</td>
                            <td>{idlePct.toFixed(0)}%</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          {live.length >= 2 && baseline && compare ? (
            <article className="fleet-dash-card">
              <div className="fleet-dash-card-head">
                <h3>
                  <IcoFleet /> Compare
                </h3>
                <div className="fleet-an-compare-picks">
                  <label className="fleet-cc-field">
                    <span>First</span>
                    <select
                      value={baseline.userId}
                      onChange={(e) => setBaselineId(Number(e.target.value))}
                    >
                      {live.map((v) => (
                        <option key={v.userId} value={v.userId}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="fleet-cc-field">
                    <span>Second</span>
                    <select
                      value={compare.userId}
                      onChange={(e) => setCompareId(Number(e.target.value))}
                    >
                      {live.map((v) => (
                        <option key={v.userId} value={v.userId}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              {compareMetrics.length ? (
                <div className="fleet-an-compare">
                  {compareMetrics.map((m) => {
                    const tone = deltaTone(m);
                    const delta =
                      m.pct === null ? "—" : m.pct === 0 ? "Same" : `${m.pct > 0 ? "+" : ""}${m.pct.toFixed(0)}%`;
                    return (
                      <div key={m.id} className="fleet-an-compare-item">
                        <span className="fleet-dash-kpi-label">{m.label}</span>
                        <strong>{formatCompare(m.id, m.b, units)}</strong>
                        <p className="muted">
                          vs {formatCompare(m.id, m.a, units)}
                          <em className={`fleet-an-delta is-${tone}`}> {delta}</em>
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="fleet-dash-empty muted">No overlapping totals to compare.</p>
              )}
            </article>
          ) : null}
        </>
      )}
    </div>
  );
}
