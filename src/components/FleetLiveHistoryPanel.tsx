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
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";
import {
  IcoAlerts,
  IcoCalendar,
  IcoDevice,
  IcoFix,
  IcoHistory,
  IcoIgnition,
  IcoOdo,
  IcoSpeed,
} from "./fleetLiveIcons";

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

type Filter = "all" | "fix" | "alert";

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
  const [filter, setFilter] = useState<Filter>("all");
  const [focusMs, setFocusMs] = useState<number | null>(null);

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
    setFocusMs(null);
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

  const visible = useMemo(
    () => timeline.filter((item) => filter === "all" || item.kind === filter),
    [timeline, filter],
  );

  const focusPath = useMemo(() => {
    if (focusMs == null || slim.length < 2) return mapPath;
    const idx = slim.findIndex((p) => Date.parse(p.recordedAt) <= focusMs);
    if (idx < 0) return mapPath;
    const from = Math.max(0, idx - 8);
    const to = Math.min(slim.length, idx + 9);
    return slim.slice(from, to).map((p) => [p.lat, p.lon] as [number, number]);
  }, [focusMs, slim, mapPath]);

  const avgSpeed = useMemo(() => {
    let sum = 0;
    let n = 0;
    for (const p of points) {
      if (p.speed != null && Number.isFinite(p.speed)) {
        sum += p.speed;
        n += 1;
      }
    }
    return n ? sum / n : null;
  }, [points]);

  return (
    <div className="fleet-sec fleet-hist">
      <FleetLiveSectionHead
        section="history"
        title="History"
        subtitle={loading ? "Loading…" : "Day timeline of fixes & safety"}
        actions={
          <div className="fleet-trips-filters">
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
                <IcoCalendar /> Date
              </span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
        }
      />

      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

      <div className="fleet-trips-kpis" role="group" aria-label="Day totals">
        <div className="fleet-trips-kpi is-focus">
          <span className="fleet-trips-kpi-ico">
            <IcoFix />
          </span>
          <div>
            <strong>{points.length}</strong>
            <em>Fixes</em>
            <span className="muted">gps samples</span>
          </div>
        </div>
        <div className="fleet-trips-kpi">
          <span className="fleet-trips-kpi-ico">
            <IcoAlerts />
          </span>
          <div>
            <strong>{alerts.length}</strong>
            <em>Alerts</em>
            <span className="muted">on {date}</span>
          </div>
        </div>
        <div className="fleet-trips-kpi">
          <span className="fleet-trips-kpi-ico">
            <IcoSpeed />
          </span>
          <div>
            <strong>{avgSpeed != null ? formatSpeed(avgSpeed) : "—"}</strong>
            <em>Avg speed</em>
            <span className="muted">km/h</span>
          </div>
        </div>
        <div className="fleet-trips-kpi">
          <span className="fleet-trips-kpi-ico">
            <IcoHistory />
          </span>
          <div>
            <strong>{visible.length}</strong>
            <em>Shown</em>
            <span className="muted">{filter}</span>
          </div>
        </div>
      </div>

      <div className="fleet-trips-body">
        <div className="fleet-hist-timeline-pane">
          <header className="fleet-trips-list-head">
            <strong>
              Timeline <span className="muted">· {visible.length}</span>
            </strong>
            <div className="fleet-ico-tabs" role="tablist">
              {(
                [
                  { id: "all" as const, label: "All" },
                  { id: "fix" as const, label: "Fixes" },
                  { id: "alert" as const, label: "Alerts" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  className={filter === tab.id ? "is-active" : ""}
                  aria-selected={filter === tab.id}
                  onClick={() => setFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </header>

          {visible.length === 0 ? (
            <p className="muted fleet-dash-empty">
              {loading ? "Loading…" : "No history for this filter."}
            </p>
          ) : (
            <ul className="fleet-hist-timeline">
              {visible.map((item) =>
                item.kind === "alert" ? (
                  <li key={item.id} className={`is-alert${focusMs === item.ms ? " is-focus" : ""}`}>
                    <button
                      type="button"
                      className="fleet-hist-item"
                      onClick={() => setFocusMs(item.ms)}
                    >
                      <time>{formatStamp(item.ms, timezone)}</time>
                      <div className="fleet-hist-row">
                        <span className="fleet-hist-kind is-alert" title="Alert">
                          <IcoAlerts />
                        </span>
                        <div>
                          <strong>{alarmLabel(item.event.alarmType)}</strong>
                          <span className="muted"> · L{item.event.alarmLevel}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                ) : (
                  <li key={item.id} className={focusMs === item.ms ? "is-focus" : ""}>
                    <button
                      type="button"
                      className="fleet-hist-item"
                      onClick={() => setFocusMs(item.ms)}
                    >
                      <time>{formatStamp(item.ms, timezone)}</time>
                      <div className="fleet-hist-row">
                        <span className="fleet-hist-kind" title="Fix">
                          <IcoFix />
                        </span>
                        <div>
                          <strong>
                            {item.point.speed != null ? (
                              <>
                                <IcoSpeed /> {formatSpeed(item.point.speed)} km/h
                              </>
                            ) : (
                              "Fix"
                            )}
                          </strong>
                          <span className="muted fleet-hist-detail">
                            {item.point.lat.toFixed(5)}, {item.point.lon.toFixed(5)}
                            {item.point.odometerKm != null ? (
                              <>
                                {" · "}
                                <IcoOdo /> {formatKm(item.point.odometerKm)}
                              </>
                            ) : null}
                            {item.point.ignition === true ? (
                              <>
                                {" · "}
                                <IcoIgnition /> on
                              </>
                            ) : item.point.ignition === false ? (
                              <>
                                {" · "}
                                <IcoIgnition /> off
                              </>
                            ) : null}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
        <div className="fleet-trips-map-pane">
          <FleetDayTrailMap path={focusPath} />
        </div>
      </div>
    </div>
  );
}
