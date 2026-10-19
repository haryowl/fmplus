import { useEffect, useMemo, useState } from "react";
import { formatKm, formatSpeed } from "../lib/format";
import { slimDayPoints } from "../lib/deviceDayTrips";
import { todayKeyInOffset } from "../lib/time";
import { tenantHeaders } from "../lib/tenant";
import {
  fetchTrackerDeviceDay,
  type TrackerDayPoint,
} from "../lib/trackerDevices";
import { FleetDayTrailMap } from "./FleetDayTrailMap";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";

type SafetyEvent = {
  id: string;
  deviceId: string;
  alarmType: string;
  alarmLevel: number;
  recordedAt: string;
};

type TimelineItem =
  | {
      kind: "fix";
      id: string;
      ms: number;
      point: TrackerDayPoint;
    }
  | {
      kind: "alert";
      id: string;
      ms: number;
      event: SafetyEvent;
    };

type Props = {
  devices: FleetTripDeviceOption[];
  timezone: string;
  initialDeviceId?: string;
};

function alarmLabel(type: string): string {
  return String(type || "alert")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatStamp(ms: number, tz: string): string {
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

async function fetchDeviceSafety(
  deviceId: string,
  signal?: AbortSignal,
): Promise<SafetyEvent[]> {
  const q = new URLSearchParams({ deviceId, limit: "100" });
  const res = await fetch(`/api/tracker/safety-events?${q}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { events?: SafetyEvent[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Safety ${res.status}`);
  return data.events || [];
}

export function FleetLiveHistoryPanel({ devices, timezone, initialDeviceId }: Props) {
  const [deviceId, setDeviceId] = useState(
    () => initialDeviceId || devices[0]?.deviceId || "",
  );
  const [date, setDate] = useState(() => todayKeyInOffset(timezone));
  const [points, setPoints] = useState<TrackerDayPoint[]>([]);
  const [alerts, setAlerts] = useState<SafetyEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!deviceId && devices[0]?.deviceId) setDeviceId(devices[0].deviceId);
  }, [devices, deviceId]);

  useEffect(() => {
    if (!deviceId || !date) {
      setPoints([]);
      setAlerts([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      fetchTrackerDeviceDay({ deviceId, date, tzOffset: timezone }, ac.signal),
      fetchDeviceSafety(deviceId, ac.signal).catch(() => [] as SafetyEvent[]),
    ])
      .then(([day, safety]) => {
        setPoints(day.points);
        const start = Date.parse(`${date}T00:00:00${timezone}`);
        const end = start + 86_400_000;
        setAlerts(
          safety.filter((e) => {
            const t = Date.parse(e.recordedAt);
            return Number.isFinite(t) && t >= start && t < end;
          }),
        );
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setPoints([]);
          setAlerts([]);
          setError(err.message || "Failed to load history");
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [deviceId, date, timezone]);

  const slim = useMemo(() => slimDayPoints(points, 600), [points]);
  const mapPath = useMemo(
    () => slim.map((p) => [p.lat, p.lon] as [number, number]),
    [slim],
  );

  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    const sample = slimDayPoints(points, 200);
    for (const p of sample) {
      const ms = Date.parse(p.recordedAt);
      if (!Number.isFinite(ms)) continue;
      items.push({ kind: "fix", id: `f-${p.recordedAt}-${p.lat}`, ms, point: p });
    }
    for (const e of alerts) {
      const ms = Date.parse(e.recordedAt);
      if (!Number.isFinite(ms)) continue;
      items.push({ kind: "alert", id: e.id, ms, event: e });
    }
    items.sort((a, b) => b.ms - a.ms);
    return items;
  }, [points, alerts]);

  return (
    <div className="fleet-hist">
      <header className="fleet-trips-head">
        <div>
          <h2>History</h2>
          <p className="muted">
            Day timeline of GPS fixes and safety events
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
        {points.length} fixes · {alerts.length} alert{alerts.length === 1 ? "" : "s"} on {date}
      </div>

      <div className="fleet-trips-body">
        <div className="fleet-hist-timeline-pane">
          {timeline.length === 0 ? (
            <p className="muted fleet-dash-empty">
              {loading ? "Loading…" : "No history for this device/day."}
            </p>
          ) : (
            <ul className="fleet-hist-timeline">
              {timeline.map((item) =>
                item.kind === "alert" ? (
                  <li key={item.id} className="is-alert">
                    <time>{formatStamp(item.ms, timezone)}</time>
                    <div>
                      <strong>{alarmLabel(item.event.alarmType)}</strong>
                      <span className="muted"> · level {item.event.alarmLevel}</span>
                    </div>
                  </li>
                ) : (
                  <li key={item.id}>
                    <time>{formatStamp(item.ms, timezone)}</time>
                    <div>
                      <strong>
                        {item.point.speed != null
                          ? `${formatSpeed(item.point.speed)} km/h`
                          : "Fix"}
                      </strong>
                      <span className="muted">
                        {" "}
                        · {item.point.lat.toFixed(5)}, {item.point.lon.toFixed(5)}
                        {item.point.odometerKm != null
                          ? ` · ${formatKm(item.point.odometerKm)} km`
                          : ""}
                        {item.point.ignition === true
                          ? " · ign on"
                          : item.point.ignition === false
                            ? " · ign off"
                            : ""}
                      </span>
                    </div>
                  </li>
                ),
              )}
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
