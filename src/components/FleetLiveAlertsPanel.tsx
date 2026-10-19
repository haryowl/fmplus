import { useEffect, useMemo, useState } from "react";
import { todayKeyInOffset, addDays, zonedEndMs, zonedStartMs } from "../lib/time";
import {
  alarmLabel,
  fetchFleetAlerts,
  type FleetMediaEvent,
} from "../lib/fleetMedia";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";

type Props = {
  devices: FleetTripDeviceOption[];
  groupId: string;
  timezone: string;
  initialDeviceId?: string;
  onOpenLive?: (deviceId: string) => void;
};

function formatWhen(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
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

export function FleetLiveAlertsPanel({
  devices,
  groupId,
  timezone,
  initialDeviceId,
}: Props) {
  const [sub, setSub] = useState<"events" | "rules">("events");
  const [deviceId, setDeviceId] = useState(() => initialDeviceId || "");
  const [dateFrom, setDateFrom] = useState(() => addDays(todayKeyInOffset(timezone), -1));
  const [dateTo, setDateTo] = useState(() => todayKeyInOffset(timezone));
  const [minLevel, setMinLevel] = useState(0);
  const [events, setEvents] = useState<FleetMediaEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (sub !== "events") return;
    const ac = new AbortController();
    setLoading(true);
    setError("");
    const from = new Date(zonedStartMs(dateFrom, timezone)).toISOString();
    const to = new Date(zonedEndMs(dateTo, timezone)).toISOString();
    fetchFleetAlerts(
      {
        deviceId: deviceId || undefined,
        groupId: groupId || undefined,
        from,
        to,
        limit: 150,
      },
      ac.signal,
    )
      .then(setEvents)
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setEvents([]);
          setError(err.message || "Failed to load alerts");
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [sub, deviceId, groupId, dateFrom, dateTo, timezone]);

  const filtered = useMemo(
    () => events.filter((e) => (e.alarmLevel || 0) >= minLevel),
    [events, minLevel],
  );

  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) {
      const k = e.alarmType || "unknown";
      map.set(k, (map.get(k) || 0) + 1);
    }
    return [...map.entries()]
      .map(([type, n]) => ({ type, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
  }, [filtered]);

  return (
    <div className="fleet-alerts">
      <header className="fleet-trips-head">
        <div>
          <h2>Alerts</h2>
          <p className="muted">
            Safety events from gateway devices
            {loading ? " · loading…" : ""}
          </p>
        </div>
        <div className="fleet-media-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={sub === "events" ? "is-active" : ""}
            aria-selected={sub === "events"}
            onClick={() => setSub("events")}
          >
            Events
          </button>
          <button
            type="button"
            role="tab"
            className={sub === "rules" ? "is-active" : ""}
            aria-selected={sub === "rules"}
            onClick={() => setSub("rules")}
          >
            Rules
          </button>
        </div>
      </header>

      {sub === "rules" ? (
        <div className="fleet-cc-section-soon">
          <h3>Alert rules</h3>
          <p className="muted">
            Flexible formulas on mapped attrs / GPS with Email + WhatsApp notify are next (P2).
            Events browse is available now.
          </p>
        </div>
      ) : (
        <>
          <div className="fleet-trips-filters">
            <label className="fleet-cc-field">
              <span>Device</span>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">All devices</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fleet-cc-field">
              <span>From</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="fleet-cc-field">
              <span>To</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label className="fleet-cc-field">
              <span>Min level</span>
              <select
                value={String(minLevel)}
                onChange={(e) => setMinLevel(Number(e.target.value) || 0)}
              >
                <option value="0">All</option>
                <option value="1">≥ 1</option>
                <option value="2">≥ 2</option>
                <option value="3">≥ 3</option>
              </select>
            </label>
          </div>

          {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

          <div className="fleet-alerts-body">
            <section className="fleet-dash-card">
              <h3>
                Events <span className="muted">{filtered.length}</span>
              </h3>
              {filtered.length === 0 ? (
                <p className="muted fleet-dash-empty">
                  {loading ? "Loading…" : "No safety events in this range."}
                </p>
              ) : (
                <ul className="fleet-alerts-list">
                  {filtered.map((e) => (
                    <li key={e.id}>
                      <span
                        className={`fleet-cc-alert-lvl is-l${Math.min(3, Math.max(0, e.alarmLevel || 0))}`}
                      />
                      <div>
                        <strong>{alarmLabel(e.alarmType)}</strong>
                        <span className="muted">
                          {" "}
                          · {e.deviceLabel || e.imei || e.deviceId.slice(0, 8)}
                          {e.sourceProtocol ? ` · ${e.sourceProtocol}` : ""}
                          {e.mediaKind && e.mediaKind !== "other" ? ` · ${e.mediaKind}` : ""}
                        </span>
                        <div className="muted">{formatWhen(e.recordedAt, timezone)}</div>
                      </div>
                      <em className="fleet-alerts-lvl">L{e.alarmLevel || 0}</em>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="fleet-dash-card">
              <h3>By type</h3>
              {byType.length === 0 ? (
                <p className="muted fleet-dash-empty">—</p>
              ) : (
                <ul className="fleet-dash-list">
                  {byType.map((row) => (
                    <li key={row.type}>
                      <span>{alarmLabel(row.type)}</span>
                      <strong>{row.n}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
