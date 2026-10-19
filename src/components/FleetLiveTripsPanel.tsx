import { useEffect, useMemo, useRef, useState } from "react";
import { formatKm, formatSpeed } from "../lib/format";
import { buildDeviceTrips, type DeviceTrip } from "../lib/deviceDayTrips";
import { todayKeyInOffset } from "../lib/time";
import {
  fetchTrackerDeviceDay,
  type TrackerDayPoint,
} from "../lib/trackerDevices";
import { FleetDayTrailMap } from "./FleetDayTrailMap";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import {
  IcoCalendar,
  IcoClose,
  IcoDevice,
  IcoFix,
  IcoHistory,
  IcoOdo,
  IcoSpeed,
  IcoTrips,
} from "./fleetLiveIcons";

export type FleetTripDeviceOption = {
  deviceId: string;
  label: string;
};

type Props = {
  devices: FleetTripDeviceOption[];
  timezone: string;
  initialDeviceId?: string;
};

type KpiKey = "trips" | "distance" | "duration" | "points";

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

function SpeedSpark({ speeds, maxSpeed, active }: { speeds: number[]; maxSpeed: number; active?: boolean }) {
  const peak = maxSpeed > 0 ? maxSpeed : Math.max(1, ...speeds);
  const bars = speeds.length ? speeds : [0];
  return (
    <div className={`fleet-trips-spark${active ? " is-active" : ""}`} aria-hidden>
      {bars.map((s, i) => (
        <i key={i} style={{ height: `${Math.max(10, Math.round((s / peak) * 100))}%` }} />
      ))}
    </div>
  );
}

function exportTripGpx(trip: DeviceTrip, label: string) {
  const name = `${label || "trip"}-${trip.index}`.replace(/[^\w.-]+/g, "_");
  const trkpts = trip.path
    .map(([lat, lon], i) => {
      const t = trip.startMs + (trip.durationMs * i) / Math.max(1, trip.path.length - 1);
      return `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><time>${new Date(t).toISOString()}</time></trkpt>`;
    })
    .join("\n");
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fleet Live">
  <trk><name>${name}</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>`;
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function FleetLiveTripsPanel({ devices, timezone, initialDeviceId }: Props) {
  const [deviceId, setDeviceId] = useState(
    () => initialDeviceId || devices[0]?.deviceId || "",
  );
  const [date, setDate] = useState(() => todayKeyInOffset(timezone));
  const [points, setPoints] = useState<TrackerDayPoint[]>([]);
  const [protocol, setProtocol] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kpiFocus, setKpiFocus] = useState<KpiKey>("distance");
  const [detailOpen, setDetailOpen] = useState(true);
  const [replayT, setReplayT] = useState<number | null>(null);
  const [replaying, setReplaying] = useState(false);
  const replayTimer = useRef<number | null>(null);
  const loadedAt = useRef<number | null>(null);

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
    setReplayT(null);
    setReplaying(false);
    fetchTrackerDeviceDay({ deviceId, date, tzOffset: timezone }, ac.signal)
      .then((day) => {
        setPoints(day.points);
        const proto = day.points.find((p) => p.sourceProtocol)?.sourceProtocol || "";
        setProtocol(proto);
        loadedAt.current = Date.now();
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

  useEffect(() => {
    return () => {
      if (replayTimer.current != null) window.clearInterval(replayTimer.current);
    };
  }, []);

  const selected = trips.find((t) => t.id === selectedId) || null;
  const mapPath = selected?.path || [];
  const deviceLabel = devices.find((d) => d.deviceId === deviceId)?.label || "Device";

  const totals = useMemo(() => {
    let distanceKm = 0;
    let durationMs = 0;
    for (const t of trips) {
      distanceKm += t.distanceKm;
      durationMs += t.durationMs;
    }
    return { distanceKm, durationMs, n: trips.length };
  }, [trips]);

  const longestId = useMemo(() => {
    let best: DeviceTrip | null = null;
    for (const t of trips) {
      if (!best || t.distanceKm > best.distanceKm) best = t;
    }
    return best?.id || null;
  }, [trips]);

  const fastestId = useMemo(() => {
    let best: DeviceTrip | null = null;
    for (const t of trips) {
      if (!best || t.maxSpeedKmh > best.maxSpeedKmh) best = t;
    }
    return best?.id || null;
  }, [trips]);

  const syncedLabel = useMemo(() => {
    if (loading) return "Loading…";
    if (!loadedAt.current) return "";
    const mins = Math.max(0, Math.round((Date.now() - loadedAt.current) / 60_000));
    const ago = mins <= 0 ? "just now" : mins === 1 ? "1 min ago" : `${mins} min ago`;
    return protocol ? `Synced ${ago} · ${protocol}` : `Synced ${ago}`;
  }, [loading, protocol, points]);

  const stopReplay = () => {
    if (replayTimer.current != null) {
      window.clearInterval(replayTimer.current);
      replayTimer.current = null;
    }
    setReplaying(false);
    setReplayT(null);
  };

  const startReplay = () => {
    if (!selected || selected.path.length < 2) return;
    stopReplay();
    setDetailOpen(true);
    setReplaying(true);
    setReplayT(0);
    const started = performance.now();
    const duration = Math.min(18_000, Math.max(6_000, selected.durationMs / 20));
    replayTimer.current = window.setInterval(() => {
      const t = (performance.now() - started) / duration;
      if (t >= 1) {
        if (replayTimer.current != null) {
          window.clearInterval(replayTimer.current);
          replayTimer.current = null;
        }
        setReplaying(false);
        setReplayT(1);
        return;
      }
      setReplayT(t);
    }, 40);
  };

  return (
    <div className="fleet-sec fleet-trips">
      <FleetLiveSectionHead
        section="trips"
        title="Trips"
        badge="DAY"
        subtitle={loading ? "Loading day track…" : "Segments from speed / ignition"}
        meta={syncedLabel || undefined}
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
        <button
          type="button"
          className={`fleet-trips-kpi${kpiFocus === "trips" ? " is-focus" : ""}`}
          onClick={() => setKpiFocus("trips")}
        >
          <span className="fleet-trips-kpi-ico">
            <IcoTrips />
          </span>
          <div>
            <strong>{totals.n}</strong>
            <em>Trips</em>
            <span className="muted">segments today</span>
          </div>
        </button>
        <button
          type="button"
          className={`fleet-trips-kpi${kpiFocus === "distance" ? " is-focus" : ""}`}
          onClick={() => setKpiFocus("distance")}
        >
          <span className="fleet-trips-kpi-ico">
            <IcoOdo />
          </span>
          <div>
            <strong>{formatKm(totals.distanceKm)}</strong>
            <em>Distance</em>
            <span className="muted">total driven · km</span>
          </div>
        </button>
        <button
          type="button"
          className={`fleet-trips-kpi${kpiFocus === "duration" ? " is-focus" : ""}`}
          onClick={() => setKpiFocus("duration")}
        >
          <span className="fleet-trips-kpi-ico">
            <IcoHistory />
          </span>
          <div>
            <strong>{formatDur(totals.durationMs)}</strong>
            <em>Duration</em>
            <span className="muted">moving time</span>
          </div>
        </button>
        <button
          type="button"
          className={`fleet-trips-kpi${kpiFocus === "points" ? " is-focus" : ""}`}
          onClick={() => setKpiFocus("points")}
        >
          <span className="fleet-trips-kpi-ico">
            <IcoFix />
          </span>
          <div>
            <strong>{points.length}</strong>
            <em>Points</em>
            <span className="muted">gps fixes</span>
          </div>
        </button>
      </div>

      <div className="fleet-trips-body">
        <div className="fleet-trips-list-pane">
          <header className="fleet-trips-list-head">
            <strong>
              All segments <span className="muted">· {trips.length}</span>
            </strong>
            <div className="fleet-trips-highlights">
              {longestId ? (
                <button
                  type="button"
                  className="fleet-trips-hl is-long"
                  onClick={() => {
                    setSelectedId(longestId);
                    setDetailOpen(true);
                  }}
                >
                  Longest
                </button>
              ) : null}
              {fastestId ? (
                <button
                  type="button"
                  className="fleet-trips-hl is-fast"
                  onClick={() => {
                    setSelectedId(fastestId);
                    setDetailOpen(true);
                  }}
                >
                  Fastest
                </button>
              ) : null}
            </div>
          </header>

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
              {trips.map((t) => {
                const isSel = selectedId === t.id;
                return (
                  <li key={t.id} className={isSel ? "is-selected" : ""}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(t.id);
                        setDetailOpen(true);
                        stopReplay();
                      }}
                    >
                      <span className="fleet-trips-card-top">
                        <strong>
                          <IcoTrips /> #{t.index}
                        </strong>
                        <span className="muted">
                          {formatTime(t.startMs, timezone)} – {formatTime(t.endMs, timezone)}
                        </span>
                        {isSel ? <span className="fleet-trips-moving">Moving</span> : null}
                      </span>
                      <span className="fleet-trips-meta">
                        <span title="Distance">
                          <IcoOdo /> {formatKm(t.distanceKm)} km
                        </span>
                        <span title="Duration">
                          <IcoHistory /> {formatDur(t.durationMs)}
                        </span>
                        <span title="Avg / max speed">
                          <IcoSpeed /> {formatSpeed(t.avgSpeedKmh)} / {formatSpeed(t.maxSpeedKmh)}
                        </span>
                      </span>
                      <SpeedSpark speeds={t.speeds} maxSpeed={t.maxSpeedKmh} active={isSel} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="fleet-trips-map-pane">
          <FleetDayTrailMap path={mapPath} replayT={replayT} />

          {selected && detailOpen ? (
            <aside className="fleet-trips-detail" aria-label={`Trip ${selected.index} detail`}>
              <header>
                <span className="fleet-trips-detail-badge">#{selected.index}</span>
                <div>
                  <strong>
                    Trip #{selected.index} · {formatKm(selected.distanceKm)} km in{" "}
                    {formatDur(selected.durationMs)}
                  </strong>
                  <p className="muted">
                    {formatTime(selected.startMs, timezone)} – {formatTime(selected.endMs, timezone)}
                    {" · "}
                    {selected.pointCount} fixes
                  </p>
                </div>
                <button
                  type="button"
                  className="fleet-cc-icon-btn"
                  title="Close detail"
                  aria-label="Close detail"
                  onClick={() => {
                    setDetailOpen(false);
                    stopReplay();
                  }}
                >
                  <IcoClose />
                </button>
              </header>

              <div className="fleet-trips-detail-metrics">
                <div>
                  <span>Avg speed</span>
                  <strong>{formatSpeed(selected.avgSpeedKmh)} km/h</strong>
                </div>
                <div>
                  <span>Max speed</span>
                  <strong>{formatSpeed(selected.maxSpeedKmh)} km/h</strong>
                </div>
                <div>
                  <span>Points</span>
                  <strong>{selected.pointCount}</strong>
                </div>
              </div>

              <div className="fleet-trips-detail-spark">
                <span className="muted">Speed profile</span>
                <SpeedSpark speeds={selected.speeds} maxSpeed={selected.maxSpeedKmh} active />
              </div>

              <div className="fleet-trips-detail-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-compact"
                  onClick={() => (replaying ? stopReplay() : startReplay())}
                  disabled={selected.path.length < 2}
                >
                  {replaying ? "Stop replay" : "Replay route"}
                </button>
                <button
                  type="button"
                  className="fleet-cc-icon-btn"
                  onClick={() => exportTripGpx(selected, deviceLabel)}
                  disabled={selected.path.length < 2}
                >
                  Export GPX
                </button>
              </div>
            </aside>
          ) : null}

          {selected && !detailOpen ? (
            <button
              type="button"
              className="fleet-trips-detail-reopen"
              onClick={() => setDetailOpen(true)}
            >
              <IcoTrips /> #{selected.index} detail
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
