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
import { IcoCalendar, IcoDevice } from "./fleetLiveIcons";

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
    <div className="fleet-cc-analytics">
      <FleetLiveSectionHead
        section="full"
        title="Full"
        subtitle="Single-asset metrics from Device Source (GPS distance, utilization, track)."
        badge="DEVICE"
        meta={
          selected
            ? `${selected.label} · ${dateFrom} → ${dateTo}`
            : "Pick a device and load a range"
        }
      />
      <div className="fleet-cc-analytics-filters">
        <label className="fleet-cc-pill">
          <IcoDevice />
          <span className="sr-only">Device</span>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.length === 0 ? <option value="">No devices</option> : null}
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fleet-cc-pill">
          <IcoCalendar />
          <span className="sr-only">From</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="fleet-cc-pill">
          <IcoCalendar />
          <span className="sr-only">To</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <div className="period-switch" role="tablist" aria-label="Period">
          {(["daily", "weekly", "monthly"] as Period[]).map((item) => (
            <button
              key={item}
              type="button"
              className={period === item ? "active" : ""}
              onClick={() => setPeriod(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-compact"
          disabled={!deviceId || loading}
          onClick={() => void handleLoad()}
        >
          {loading
            ? progress
              ? `Loading ${progress.loaded}/${progress.total}`
              : "Loading…"
            : "Load metrics"}
        </button>
      </div>
      <p className="muted fleet-cc-analytics-hint">
        Uses tracker fixes only (max {DEVICE_METRICS_MAX_DAYS} days). Fuel and RPM stay empty unless
        the mapper stored those values on the fix.
      </p>
      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

      <section className="kpis">
        <article className="kpi" style={{ ["--tick" as string]: "var(--gps)" }}>
          <div className="label">GPS distance</div>
          <div className="value">{trips ? units.distance(totals.gps, false) : "—"}</div>
          <div className="unit">{units.distanceUnit} · all points</div>
        </article>
        <article className="kpi" style={{ ["--tick" as string]: "var(--ign)" }}>
          <div className="label">Ignition distance</div>
          <div className="value">{trips ? units.distance(totals.ignition, false) : "—"}</div>
          <div className="unit">{units.distanceUnit} · engine on</div>
        </article>
        <article className="kpi" style={{ ["--tick" as string]: "var(--odo)" }}>
          <div className="label">Odometer</div>
          <div className="value">{trips ? units.distance(totals.odometer, false) : "—"}</div>
          <div className="unit">
            {units.distanceUnit} · {trips ? `vs GPS ${odoGpsDelta(totals.odometer, totals.ignition)}` : "device"}
          </div>
        </article>
        <article className="kpi" style={{ ["--tick" as string]: "var(--hrs)" }}>
          <div className="label">Active time</div>
          <div className="value">{trips ? formatHours(totals.hours) : "—"}</div>
          <div className="unit">{trips ? `${formatHours(totals.idle)} h idle` : "hours moving"}</div>
        </article>
      </section>

      {rows.length ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Distance &amp; active time</h2>
                <p>GPS and ignition-on kilometres from Device Source, with moving hours.</p>
              </div>
            </div>
            <DistanceChart rows={rows} />
          </section>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Utilization</h2>
                <p>Engine-on hours split into moving versus idle.</p>
              </div>
            </div>
            <UtilizationChart rows={rows} />
          </section>
          {mapData ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Track</h2>
                  <p>GPS path for the loaded range.</p>
                </div>
              </div>
              <TrackMap data={mapData} />
            </section>
          ) : null}
          {insights.length ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Insights</h2>
                  <p>Template notes from Device Source kilometres and hours.</p>
                </div>
              </div>
              <ul className="fleet-cc-insight-list">
                {insights.map((block) => (
                  <li key={block.id}>
                    <strong>{block.title}</strong>
                    <p>{block.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <section className="panel">
          <div className="empty">
            <div>
              <h3>{loading ? "Loading device days…" : "Load a device range"}</h3>
              <p>Pick a tracker device, choose dates, then load. Charts use the same metrics engine as Full.</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
