import { useEffect, useMemo, useState } from "react";
import { DEVICE_METRICS_MAX_DAYS, deviceBehavior, devicePeriodMetrics, fetchDeviceTripsForRange } from "../lib/deviceMetrics";
import { buildInsights } from "../lib/insight";
import { formatHours, odoGpsDelta } from "../lib/format";
import { addDays, todayKeyInOffset } from "../lib/time";
import { buildTrackMap } from "../lib/trackMap";
import type { Period, Trip } from "../lib/types";
import { useUnitSystem } from "../lib/unitSystem";
import { DistanceChart } from "./DistanceChart";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";
import { TrackMap } from "./TrackMap";
import { UtilizationChart } from "./UtilizationChart";
import { IcoCalendar, IcoDevice, IcoHistory, IcoIgnition, IcoOdo, IcoPin, IcoUtil } from "./fleetLiveIcons";

type Props = {
  devices: FleetTripDeviceOption[];
  timezone: string;
  initialDeviceId?: string;
};

export function FleetLiveFullPanel({ devices, timezone, initialDeviceId }: Props) {
  const units = useUnitSystem();
  const defaultTo = todayKeyInOffset(timezone);
  const [deviceId, setDeviceId] = useState(initialDeviceId || devices[0]?.deviceId || "");
  const [dateFrom, setDateFrom] = useState(() => addDays(defaultTo, -6));
  const [dateTo, setDateTo] = useState(defaultTo);
  const [period, setPeriod] = useState<Period>("daily");
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);

  useEffect(() => {
    if (!deviceId && devices[0]) setDeviceId(devices[0].deviceId);
    if (deviceId && devices.length && !devices.some((d) => d.deviceId === deviceId)) {
      setDeviceId(devices[0]?.deviceId || "");
    }
  }, [devices, deviceId]);

  const selected = devices.find((d) => d.deviceId === deviceId);
  const { rows, totals } = useMemo(
    () =>
      trips
        ? devicePeriodMetrics(trips, {
            period,
            dateFrom,
            dateTo,
            timezone,
            minSpeedKmh: selected?.tripMinSpeedKmh,
            tripBreakMin: selected?.tripBreakMin,
          })
        : { rows: [], totals: devicePeriodMetrics([], { period, dateFrom, dateTo, timezone }).totals },
    [trips, period, dateFrom, dateTo, timezone, selected?.tripMinSpeedKmh, selected?.tripBreakMin],
  );
  const behavior = useMemo(
    () => (trips ? deviceBehavior(trips, totals.gps, { period, dateFrom, dateTo, timezone }) : null),
    [trips, totals.gps, period, dateFrom, dateTo, timezone],
  );
  const insights = useMemo(() => {
    if (!rows.length) return [];
    return buildInsights({
      gpsKm: totals.gps,
      activeHours: totals.hours,
      idleHours: totals.idle,
      avgSpeedKmh: totals.avgSpeed,
      avgRpm: totals.avgRpm,
      maxRpm: totals.maxRpm,
      fuelUsedL: totals.fuel,
      canFuelUsedL: totals.canFuel,
      tankFuelUsedL: totals.tankFuel,
      kmPerL: totals.fuel > 0 ? totals.gps / totals.fuel : 0,
      flatKmPerL: totals.flatKmPerL,
      terrainImpactPct: totals.terrainImpactPct,
      elevationGainM: totals.elevationGainM,
      elevationLossM: totals.elevationLossM,
      altitudeSamples: totals.altitudeSamples,
      roadSamples: totals.roadSamples,
      roadSmoothPct: totals.roadSmoothPct,
      roadRoughPct: totals.roadRoughPct,
      roadBumpyPct: totals.roadBumpyPct,
      avgVibrationMg: totals.avgVibrationMg,
      behavior,
    }, "standard");
  }, [rows.length, totals, behavior]);
  const mapData = useMemo(
    () => (trips ? buildTrackMap(trips, { dateFrom, dateTo, timezone }) : null),
    [trips, dateFrom, dateTo, timezone],
  );

  async function handleLoad() {
    if (!deviceId) return;
    setLoading(true);
    setError("");
    setProgress({ loaded: 0, total: 1 });
    try {
      const result = await fetchDeviceTripsForRange({
        deviceId,
        dateFrom,
        dateTo,
        timezone,
        onProgress: (loaded, total) => setProgress({ loaded, total }),
      });
      setTrips(result.pointCount ? [result.trip] : []);
      if (!result.pointCount) setError("No Device Source points in this range.");
    } catch (err) {
      setTrips(null);
      setError(err instanceof Error ? err.message : "Failed to load device metrics");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  return (
    <div className="fleet-sec fleet-dash fleet-an">
      <FleetLiveSectionHead
        section="full"
        title="Full"
        subtitle="Single-asset kilometres, hours, and track from Device Source."
        badge="DEVICE"
        meta={
          <>
            <IcoHistory />
            {selected
              ? `${selected.label} · ${dateFrom} → ${dateTo}`
              : `Pick a device · max ${DEVICE_METRICS_MAX_DAYS} days`}
          </>
        }
        actions={
          <div className="fleet-an-filters">
            <label className="fleet-cc-field fleet-cc-field-ico">
              <span>
                <IcoDevice /> Device
              </span>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                {devices.length === 0 ? <option value="">No devices</option> : null}
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
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
              disabled={!deviceId || loading}
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

      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

      <section className="fleet-dash-kpis fleet-an-kpis" aria-label="Full KPIs">
        <article className="fleet-dash-kpi is-util">
          <header>
            <span className="fleet-dash-kpi-ico is-util">
              <IcoOdo />
            </span>
            <em className="fleet-dash-pill">GPS</em>
          </header>
          <span className="fleet-dash-kpi-label">Distance</span>
          <strong>{trips ? units.distance(totals.gps, false) : "—"}</strong>
          <p className="muted">{units.distanceUnit} · all points</p>
        </article>
        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico is-cover">
              <IcoIgnition />
            </span>
            <em className="fleet-dash-pill">IGN</em>
          </header>
          <span className="fleet-dash-kpi-label">Engine on</span>
          <strong>{trips ? units.distance(totals.ignition, false) : "—"}</strong>
          <p className="muted">{units.distanceUnit} · ignition</p>
        </article>
        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico is-odo">
              <IcoOdo />
            </span>
            <em className="fleet-dash-pill">{trips ? odoGpsDelta(totals.odometer, totals.ignition) : "ODO"}</em>
          </header>
          <span className="fleet-dash-kpi-label">Odometer</span>
          <strong>{trips ? units.distance(totals.odometer, false) : "—"}</strong>
          <p className="muted">{units.distanceUnit} · vs GPS</p>
        </article>
        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico is-fuel">
              <IcoUtil />
            </span>
            <em className="fleet-dash-pill">{trips ? `${formatHours(totals.idle)} idle` : "HRS"}</em>
          </header>
          <span className="fleet-dash-kpi-label">Active</span>
          <strong>{trips ? formatHours(totals.hours) : "—"}</strong>
          <p className="muted">hours moving</p>
        </article>
      </section>

      {rows.length ? (
        <>
          <div className="fleet-dash-mid">
            <article className="fleet-dash-card">
              <div className="fleet-dash-card-head">
                <h3>
                  <IcoOdo /> Distance &amp; time
                </h3>
              </div>
              <DistanceChart rows={rows} />
            </article>
            <article className="fleet-dash-card">
              <div className="fleet-dash-card-head">
                <h3>
                  <IcoUtil /> Utilization
                </h3>
              </div>
              <UtilizationChart rows={rows} />
            </article>
          </div>
          {mapData ? (
            <article className="fleet-dash-card">
              <div className="fleet-dash-card-head">
                <h3>
                  <IcoPin /> Track
                </h3>
                <span className="muted">Start / end for the loaded range</span>
              </div>
              <TrackMap data={mapData} embedded />
            </article>
          ) : null}
          {insights.length ? (
            <article className="fleet-dash-card">
              <div className="fleet-dash-card-head">
                <h3>
                  <IcoHistory /> Insights
                </h3>
              </div>
              <ul className="fleet-an-insights">
                {insights.map((block) => (
                  <li key={block.id}>
                    <strong>{block.title}</strong>
                    <p>{block.body}</p>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
        </>
      ) : (
        <article className="fleet-dash-card fleet-an-empty">
          <h3>{loading ? "Loading device days…" : "Load a device range"}</h3>
          <p>
            Choose a tracker and dates, then load. Charts use the same Device Source metrics as the
            rest of Fleet Live.
          </p>
        </article>
      )}
    </div>
  );
}
