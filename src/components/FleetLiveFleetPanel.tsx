import { useEffect, useMemo, useState } from "react";
import { FLEET_VEHICLE_CAP } from "../lib/config";
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
  type FleetVehicleRow,
} from "../lib/fleet";
import { formatHours, formatInt } from "../lib/format";
import { movingSharePct } from "../lib/metrics";
import { addDays, todayKeyInOffset } from "../lib/time";
import type { Period } from "../lib/types";
import { useUnitSystem } from "../lib/unitSystem";
import { FleetBarChart } from "./FleetBarChart";
import { FleetHeadToHead } from "./FleetHeadToHead";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import { FleetRankTable } from "./FleetRankTable";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";
import { IcoCalendar, IcoDevice } from "./fleetLiveIcons";

type Props = {
  devices: FleetTripDeviceOption[];
  timezone: string;
  initialDeviceIds?: string[];
};

export function FleetLiveFleetPanel({
  devices,
  timezone,
  initialDeviceIds,
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
    <div className="fleet-cc-analytics">
      <FleetLiveSectionHead
        section="fleet"
        title="Fleet"
        subtitle="Compare Device Source assets — GPS kilometres, hours, and rank."
        badge="DEVICE"
        meta={`${selected.length} selected · cap ${FLEET_VEHICLE_CAP}`}
      />
      <div className="fleet-cc-analytics-filters">
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
          disabled={!selected.length || loading}
          onClick={() => void handleLoad()}
        >
          {loading
            ? progress
              ? `Loading ${progress.loaded}/${progress.total}`
              : "Loading…"
            : "Load comparison"}
        </button>
      </div>
      <div className="fleet-cc-device-picks" role="group" aria-label="Devices to compare">
        <span className="muted">
          <IcoDevice /> Assets
        </span>
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
      </div>
      <p className="muted fleet-cc-analytics-hint">
        Tracker devices only (max {DEVICE_METRICS_MAX_DAYS} days each). Fuel columns stay empty without CAN.
      </p>
      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

      <section className="kpis">
        <article className="kpi" style={{ ["--tick" as string]: "var(--gps)" }}>
          <div className="label">Assets loaded</div>
          <div className="value">{vehicles ? formatInt(live.length) : "—"}</div>
          <div className="unit">of {selected.length} selected</div>
        </article>
        <article className="kpi" style={{ ["--tick" as string]: "var(--ign)" }}>
          <div className="label">Fleet GPS</div>
          <div className="value">{vehicles ? units.distance(fleetGps, false) : "—"}</div>
          <div className="unit">{units.distanceUnit} combined</div>
        </article>
        <article className="kpi" style={{ ["--tick" as string]: "var(--hrs)" }}>
          <div className="label">Active time</div>
          <div className="value">{vehicles ? formatHours(fleetHours) : "—"}</div>
          <div className="unit">
            {vehicles ? `${movingSharePct(fleetHours, fleetIdle).toFixed(0)}% moving` : "hours"}
          </div>
        </article>
      </section>

      {!live.length ? (
        <section className="panel">
          <div className="empty">
            <div>
              <h3>{loading ? "Loading device days…" : "Select assets and load"}</h3>
              <p>Tick up to {FLEET_VEHICLE_CAP} tracker devices, then load the same range.</p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Distance by asset</h2>
                <p>GPS kilometres from Device Source in the selected range.</p>
              </div>
            </div>
            <FleetBarChart
              labels={live.map((v) => v.label)}
              series={[{ label: "GPS km", data: live.map((v) => v.totals.gps), color: live[0]?.color }]}
              unit="km"
              yTitle="Distance (km)"
            />
          </section>
          {periods.length ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Distance over time</h2>
                  <p>One line per asset. Empty periods show as zero.</p>
                </div>
              </div>
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
            </section>
          ) : null}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Utilization</h2>
                <p>Engine-on hours split into moving versus idle.</p>
              </div>
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
          </section>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Rank</h2>
                <p>Same rank columns as Fleet, from Device Source totals.</p>
              </div>
            </div>
            <FleetRankTable
              vehicles={live}
              hrefFor={(userId) => {
                const deviceId = idByNumeric.get(userId) || "";
                const params = new URLSearchParams(
                  typeof window !== "undefined" ? window.location.search : "",
                );
                params.set("section", "full");
                if (deviceId) params.set("deviceId", deviceId);
                return `/fleet-live?${params}`;
              }}
            />
          </section>
          {live.length >= 2 ? (
            <FleetHeadToHead
              vehicles={live}
              baselineId={baselineId}
              compareId={compareId}
              onBaseline={setBaselineId}
              onCompare={setCompareId}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
