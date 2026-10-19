import { useEffect, useMemo, useState } from "react";
import { todayKeyInOffset, zonedEndMs, zonedStartMs } from "../lib/time";
import {
  alarmLabel,
  attachmentIsUrl,
  fetchFleetMedia,
  type FleetMediaEvent,
} from "../lib/fleetMedia";
import type { FleetTripDeviceOption } from "./FleetLiveTripsPanel";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import {
  IcoCalendar,
  IcoClose,
  IcoDevice,
  IcoMedia,
  IcoPicture,
  IcoVideo,
} from "./fleetLiveIcons";

type Tab = "picture" | "video";

type Props = {
  devices: FleetTripDeviceOption[];
  groupId: string;
  timezone: string;
  initialDeviceId?: string;
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
    return new Date(ms).toLocaleString();
  }
}

export function FleetLiveMediaPanel({
  devices,
  groupId,
  timezone,
  initialDeviceId,
}: Props) {
  const [tab, setTab] = useState<Tab>("picture");
  const [deviceId, setDeviceId] = useState(() => initialDeviceId || "");
  const [date, setDate] = useState(() => todayKeyInOffset(timezone));
  const [events, setEvents] = useState<FleetMediaEvent[]>([]);
  const [capable, setCapable] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState<FleetMediaEvent | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    const from = new Date(zonedStartMs(date, timezone)).toISOString();
    const to = new Date(zonedEndMs(date, timezone)).toISOString();
    fetchFleetMedia(
      {
        kind: tab,
        deviceId: deviceId || undefined,
        groupId: groupId || undefined,
        from,
        to,
        limit: 120,
      },
      ac.signal,
    )
      .then((res) => {
        setEvents(res.events);
        setCapable(res.mediaCapableCount ?? null);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setEvents([]);
          setError(err.message || "Failed to load media");
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [tab, deviceId, groupId, date, timezone]);

  const emptyHint = useMemo(() => {
    if (loading) return "Loading…";
    if (capable === 0) {
      return "No JT/T / MDVR-capable devices on this tenant yet.";
    }
    return "No media for this filter. Gateway keeps multimedia metadata until uploads are persisted.";
  }, [loading, capable]);

  return (
    <div className="fleet-sec fleet-media">
      <FleetLiveSectionHead
        section="media"
        title="Media"
        subtitle={
          loading
            ? "Loading…"
            : capable != null
              ? `${capable} camera-capable device${capable === 1 ? "" : "s"}`
              : "Pictures & video evidence"
        }
        actions={
          <div className="fleet-trips-filters">
            <label className="fleet-cc-field fleet-cc-field-ico">
              <span>
                <IcoDevice /> Device
              </span>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">All devices</option>
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

      <div className="fleet-ico-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "picture"}
          title="Pictures"
          className={tab === "picture" ? "is-active" : ""}
          onClick={() => setTab("picture")}
        >
          <IcoPicture />
          <span>Pics</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "video"}
          title="Video"
          className={tab === "video" ? "is-active" : ""}
          onClick={() => setTab("video")}
        >
          <IcoVideo />
          <span>Video</span>
        </button>
      </div>

      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}

      {events.length === 0 ? (
        <p className="muted fleet-dash-empty fleet-media-empty">{emptyHint}</p>
      ) : (
        <ul className="fleet-media-grid">
          {events.map((ev) => {
            const url = attachmentIsUrl(ev.attachmentId) ? ev.attachmentId : "";
            return (
              <li key={ev.id}>
                <button type="button" className="fleet-media-card" onClick={() => setActive(ev)}>
                  <div className={`fleet-media-thumb is-${ev.mediaKind}`}>
                    {tab === "picture" && url ? (
                      <img src={url} alt="" loading="lazy" />
                    ) : tab === "video" ? (
                      <IcoVideo />
                    ) : (
                      <IcoPicture />
                    )}
                  </div>
                  <div className="fleet-media-meta">
                    <strong>{ev.deviceLabel || ev.imei || ev.deviceId.slice(0, 8)}</strong>
                    <span className="muted">{alarmLabel(ev.alarmType)}</span>
                    <span className="muted">{formatWhen(ev.recordedAt, timezone)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {active ? (
        <div className="fleet-media-lightbox" role="dialog" aria-modal="true">
          <button
            type="button"
            className="fleet-media-lightbox-backdrop"
            aria-label="Close"
            onClick={() => setActive(null)}
          />
          <div className="fleet-media-lightbox-panel">
            <header>
              <div>
                <strong>{active.deviceLabel || active.imei}</strong>
                <p className="muted">
                  {alarmLabel(active.alarmType)} · {formatWhen(active.recordedAt, timezone)}
                  {active.mediaChannel != null ? ` · ch ${active.mediaChannel}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="fleet-cc-icon-btn"
                onClick={() => setActive(null)}
                title="Close"
                aria-label="Close"
              >
                <IcoClose />
              </button>
            </header>
            {attachmentIsUrl(active.attachmentId) ? (
              active.mediaKind === "video" ? (
                <video src={active.attachmentId} controls className="fleet-media-preview" />
              ) : (
                <img src={active.attachmentId} alt="" className="fleet-media-preview" />
              )
            ) : (
              <div className="fleet-media-preview-fallback">
                <p>
                  <IcoMedia /> <strong>Metadata only</strong> — media body not stored as a URL yet.
                </p>
                <dl>
                  <div>
                    <dt>Attachment id</dt>
                    <dd>{active.attachmentId || "—"}</dd>
                  </div>
                  <div>
                    <dt>Media id</dt>
                    <dd>{active.mediaId != null ? String(active.mediaId) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Kind</dt>
                    <dd>{active.mediaKind}</dd>
                  </div>
                  <div>
                    <dt>Protocol</dt>
                    <dd>{active.protocol || active.sourceProtocol || "—"}</dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>
                      {active.lat != null && active.lon != null
                        ? `${active.lat.toFixed(5)}, ${active.lon.toFixed(5)}`
                        : "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
