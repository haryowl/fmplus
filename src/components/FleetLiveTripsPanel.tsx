import { useEffect, useMemo, useState } from "react";
import { formatKm, formatSpeed } from "../lib/format";
import { buildDeviceTrips } from "../lib/deviceDayTrips";
import { todayKeyInOffset } from "../lib/time";
import {
  fetchTrackerDeviceDay,
  type TrackerDayPoint,
} from "../lib/trackerDevices";
import { FleetDayTrailMap } from "./FleetDayTrailMap";

export type FleetTripDeviceOption = {
  deviceId: string;
  label: string;
};

type Props = {
  devices: FleetTripDeviceOption[];
  timezone: string;
  initialDeviceId?: string;
};

function formatDur(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

function formatTime(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone:
        tz === "+07:00"
          ? "Asia/Jakarta"
          : tz === "+08:00"
            ? "Asia/Makassar"
            : tz === "+09:00"
              ? "Asia/Jayapura"
              : "UTC",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString();
  }
}

export function FleetLiveTripsPanel({ devices, timezone, initialDeviceId }: Props) {
  const [deviceId, setDeviceId] = useState(
    () => initialDeviceId || devices[0]?.deviceId || "",
  );
  const [date, setDate] = useState(() => todayKeyInOffset(timezone));
  const [points, setPoints] = useState<TrackerDayPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId && devices[0]?.deviceId) setDeviceId(devices[0].deviceId);
  }, [devices, deviceId]);

  useEffect(() => {
    if (!deviceId || !date) {
      setPoints([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError("");
    setSelectedId(null);
    fetchTrackerDeviceDay({ deviceId, date, tzOffset: timezone }, ac.signal)
      .then((day) => {
        setPoints(day.points);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setPoints([]);
          setError(err.message || "Failed to load day track");
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [deviceId, date, timezone]);

  const trips = useMemo(
    () => buildDeviceTrips(points, { tzOffset: timezone }),
    [points, timezone],
  );

  useEffect(() => {
    if (!selectedId && trips[0]) setSelectedId(trips[0].id);
  }, [trips, selectedId]);

  const selected = trips.find((t) => t.id === selectedId) || null;
  const mapPath = selected?.path || [];

  const totals = useMemo(() => {
    let distanceKm = 0;
    let durationMs = 0;
    for (const t of trips) {
      distanceKm += t.distanceKm;
      durationMs += t.durationMs;
    }
    return { distanceKm, durationMs, n: trips.length };
  }, [trips]);

  return (
    <div className="fleet-trips">
      <header className="fleet-trips-head">
        <div>
          <h2>Trips</h2>
          <p className="muted">
            Gateway-native segments from vehicle fixes (speed / ignition)
            {loading ? " · loading…" : ""}
          </p>
        </div>
        <div className="fleet-trips-filters">
          <label className="fleet-cc-field">
            <span>Device</span>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.length === 0 ? <option value="">No devices</option> : null}
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="fleet-cc-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      </header>

      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

      <div className="fleet-trips-summary muted">
        {totals.n} trip{totals.n === 1 ? "" : "s"} · {formatKm(totals.distanceKm)} km ·{" "}
        {formatDur(totals.durationMs)} · {points.length} fixes
      </div>

      <div className="fleet-trips-body">
        <div className="fleet-trips-list-pane">
          {trips.length === 0 ? (
            <p className="muted fleet-dash-empty">
              {loading
                ? "Loading…"
                : points.length
                  ? "No moving trips detected for this day."
                  : "No GPS fixes for this device/day."}
            </p>
          ) : (
            <ul className="fleet-trips-list">
              {trips.map((t) => (
                <li key={t.id} className={selectedId === t.id ? "is-selected" : ""}>
                  <button type="button" onClick={() => setSelectedId(t.id)}>
                    <strong>
                      Trip {t.index}
                      <span className="muted">
                        {" "}
                        · {formatTime(t.startMs, timezone)}–{formatTime(t.endMs, timezone)}
                      </span>
                    </strong>
                    <span className="muted">
                      {formatKm(t.distanceKm)} km · {formatDur(t.durationMs)} · avg{" "}
                      {formatSpeed(t.avgSpeedKmh)} km/h · max {formatSpeed(t.maxSpeedKmh)} km/h
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="fleet-trips-map-pane">
          <FleetDayTrailMap path={mapPath} />
        </div>
      </div>
    </div>
  );
}
