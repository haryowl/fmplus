import { useEffect, useMemo, useRef, useState } from "react";
import { buildDeviceTrips, type DeviceTrip } from "../lib/deviceDayTrips";
import { useUnitSystem } from "../lib/unitSystem";
import type { TripMode } from "../lib/tripMode";
import { fetchLiveReverseAddress } from "../lib/geocode";
import { addressAt, geocodeCacheKey, resolveAddressesForCoords } from "../lib/reverseGeocode";
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
  tripMode?: TripMode;
  tripMinSpeedKmh?: number;
  tripBreakMin?: number;
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
  const units = useUnitSystem();
  const [deviceId, setDeviceId] = useState(
    () => initialDeviceId || devices[0]?.deviceId || "",
  );
  const [date, setDate] = useState(() => todayKeyInOffset(timezone));
  const [points, setPoints] = useState<TrackerDayPoint[]>([]);
  const [dayTripMode, setDayTripMode] = useState<TripMode | undefined>();
  const [dayMinSpeed, setDayMinSpeed] = useState<number | undefined>();
  const [dayBreakMin, setDayBreakMin] = useState<number | undefined>();
  const [protocol, setProtocol] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kpiFocus, setKpiFocus] = useState<KpiKey>("distance");
  const [detailOpen, setDetailOpen] = useState(true);
  const [replayT, setReplayT] = useState<number | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
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
        setDayTripMode(day.tripMode);
        setDayMinSpeed(day.tripMinSpeedKmh);
        setDayBreakMin(day.tripBreakMin);
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

  const selectedDevice = devices.find((d) => d.deviceId === deviceId);
  const trips = useMemo(
    () =>
      buildDeviceTrips(points, {
        tzOffset: timezone,
        tripMode: selectedDevice?.tripMode || dayTripMode,
        minSpeedKmh: selectedDevice?.tripMinSpeedKmh ?? dayMinSpeed,
        tripBreakMin: selectedDevice?.tripBreakMin ?? dayBreakMin,
      }),
    [
      points,
      timezone,
      selectedDevice?.tripMode,
      selectedDevice?.tripMinSpeedKmh,
      selectedDevice?.tripBreakMin,
      dayTripMode,
      dayMinSpeed,
      dayBreakMin,
    ],
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

  const tripPlaceKey = useMemo(
    () =>
      trips
        .map(
          (t) =>
            `${geocodeCacheKey(t.startLat, t.startLon)}|${geocodeCacheKey(t.endLat, t.endLon)}`,
        )
        .join(";"),
    [trips],
  );

  useEffect(() => {
    if (!trips.length) return;
    const coords: Array<{ lat: number; lon: number }> = [];
    const selectedTrip = trips.find((t) => t.id === selectedId);
    if (selectedTrip) {
      coords.push({ lat: selectedTrip.startLat, lon: selectedTrip.startLon });
      coords.push({ lat: selectedTrip.endLat, lon: selectedTrip.endLon });
    }
    for (const t of trips) {
      coords.push({ lat: t.startLat, lon: t.startLon });
      coords.push({ lat: t.endLat, lon: t.endLon });
    }
    const ac = new AbortController();
    void resolveAddressesForCoords(coords, fetchLiveReverseAddress, {
      concurrency: 1,
      signal: ac.signal,
    })
      .then((map) => {
        if (!ac.signal.aborted) setAddresses((prev) => ({ ...prev, ...map }));
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          /* keep last known addresses */
        }
      });
    return () => ac.abort();
  }, [tripPlaceKey, trips, selectedId]);

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
            <strong>{units.distance(totals.distanceKm, false)}</strong>
            <em>Distance</em>
            <span className="muted">total driven · {units.distanceUnit}</span>
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
                      <span className="fleet-trips-places">
                        <span
                          title={
                            addressAt(addresses, t.startLat, t.startLon) ||
                            units.coord(t.startLat, t.startLon)
                          }
                        >
                          <em>Start</em>{" "}
                          {addressAt(addresses, t.startLat, t.startLon) ||
                            units.coord(t.startLat, t.startLon)}
                        </span>
                        <span
                          title={
                            addressAt(addresses, t.endLat, t.endLon) ||
                            units.coord(t.endLat, t.endLon)
                          }
                        >
                          <em>Stop</em>{" "}
                          {addressAt(addresses, t.endLat, t.endLon) ||
                            units.coord(t.endLat, t.endLon)}
                        </span>
                      </span>
                      <span className="fleet-trips-meta">
                        <span title="Distance">
                          <IcoOdo /> {units.distance(t.distanceKm)}
                        </span>
                        <span title="Duration">
                          <IcoHistory /> {formatDur(t.durationMs)}
                        </span>
                        <span title="Avg / max speed">
                          <IcoSpeed /> {units.speed(t.avgSpeedKmh, false)} / {units.speed(t.maxSpeedKmh, false)} {units.speedUnit}
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
                    Trip #{selected.index} · {units.distance(selected.distanceKm)} in{" "}
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

              <div className="fleet-trips-ends">
                <div>
                  <span>Start</span>
                  <strong>{formatTime(selected.startMs, timezone)}</strong>
                  <p className="muted">{units.coord(selected.startLat, selected.startLon)}</p>
                  <p className="fleet-trips-end-addr">
                    {addressAt(addresses, selected.startLat, selected.startLon) ||
                      (!(geocodeCacheKey(selected.startLat, selected.startLon) in addresses)
                        ? "Looking up address…"
                        : "—")}
                  </p>
                </div>
                <div>
                  <span>Stop</span>
                  <strong>{formatTime(selected.endMs, timezone)}</strong>
                  <p className="muted">{units.coord(selected.endLat, selected.endLon)}</p>
                  <p className="fleet-trips-end-addr">
                    {addressAt(addresses, selected.endLat, selected.endLon) ||
                      (!(geocodeCacheKey(selected.endLat, selected.endLon) in addresses)
                        ? "Looking up address…"
                        : "—")}
                  </p>
                </div>
              </div>

              <div className="fleet-trips-detail-metrics">
                <div>
                  <span>Avg speed</span>
                  <strong>{units.speed(selected.avgSpeedKmh)}</strong>
                </div>
                <div>
                  <span>Max speed</span>
                  <strong>{units.speed(selected.maxSpeedKmh)}</strong>
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
