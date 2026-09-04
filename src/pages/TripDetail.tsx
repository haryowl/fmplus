import { useEffect, useMemo, useRef, useState } from "react";
import {
  countEventsInRange,
  fetchEventsForUserDays,
  fetchGroups,
  fetchUserCustomFields,
  fetchUsersForGroup,
  groupOptionLabel,
  loadTripsForUser,
  userLabel,
  userOptionLabel,
  type ArmadaEvent,
  type CustomField,
} from "../lib/api";
import { DEFAULT_MIN_SPEED_KMH, DEFAULT_TRIP_BREAK_MIN, TIMEZONES } from "../lib/config";
import { formatHours, formatKm, formatLiters, formatRpm, formatSpeed } from "../lib/format";
import { describeLoadProgress } from "../lib/dayTracks";
import { writeLastVehicle } from "../lib/lastUsed";
import { writeLocationSearch } from "../lib/routing";
import { addDays, eachDateInclusive, offsetToMinutes, todayKeyInOffset } from "../lib/time";
import {
  buildTripSegments,
  googleMapsUrl,
  inclusiveDayCount,
  recordedHoursFromSegments,
  TRIP_DETAIL_MAX_DAYS,
  type SegmentStatus,
  type TripSegment,
} from "../lib/tripSegments";
import type { Group, LoadProgress, User } from "../lib/types";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import { BrandMark } from "../components/BrandMark";
import { TripSegmentMap } from "../components/TripSegmentMap";
import { ViewNav } from "../components/ViewNav";

type StatusFilter = Record<SegmentStatus, boolean>;

const COLUMN_KEY = "fmplus.tripDetail.columns";

type ColumnFlags = {
  customFieldNames: string[];
  rpm: boolean;
  refill: boolean;
  events: boolean;
};

const DEFAULT_COLUMNS: ColumnFlags = {
  customFieldNames: [],
  rpm: true,
  refill: true,
  events: true,
};

function readColumns(): ColumnFlags {
  try {
    const raw = localStorage.getItem(COLUMN_KEY);
    if (!raw) return { ...DEFAULT_COLUMNS };
    const parsed = JSON.parse(raw) as Partial<ColumnFlags>;
    return {
      ...DEFAULT_COLUMNS,
      ...parsed,
      customFieldNames: Array.isArray(parsed.customFieldNames) ? parsed.customFieldNames : [],
    };
  } catch {
    return { ...DEFAULT_COLUMNS };
  }
}

function formatWhen(ms: number, offset: string): string {
  const shifted = new Date(ms + offsetToMinutes(offset) * 60_000);
  const iso = shifted.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function latLonLabel(lat: number | null, lon: number | null): string {
  if (lat === null || lon === null) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export default function TripDetail() {
  const { query, ready, error: tenantError, allowedUserIds, allowedGroupIds, allowsUser, allowsGroup } =
    useEmbedTenant();
  const defaultTo = todayKeyInOffset(query.tz);
  const defaultFrom = addDays(defaultTo, 0);

  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groupId, setGroupId] = useState(query.groupId);
  const [userId, setUserId] = useState(query.userId);
  const [dateFrom, setDateFrom] = useState(query.from || defaultFrom);
  const [dateTo, setDateTo] = useState(query.to || defaultTo);
  const [timezone, setTimezone] = useState(query.tz);
  const [bootError, setBootError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [segments, setSegments] = useState<TripSegment[]>([]);
  const [events, setEvents] = useState<ArmadaEvent[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>({ trip: true, idle: true, stop: true });
  const [columns, setColumns] = useState<ColumnFlags>(() => readColumns());
  const [cfMenuOpen, setCfMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const cfMenuRef = useRef<HTMLDivElement | null>(null);

  const selectedGroup = groups.find((g) => String(g.id) === groupId);
  const selectedUser = users.find((u) => String(u.id) === userId);
  const dayCount = inclusiveDayCount(dateFrom, dateTo);
  const rangeTooLong = dayCount > TRIP_DETAIL_MAX_DAYS;

  const selectedCustomFields = customFields.filter((cf) => columns.customFieldNames.includes(cf.name));

  useEffect(() => {
    writeLocationSearch({
      groupId: groupId || null,
      userId: userId || null,
      from: dateFrom || null,
      to: dateTo || null,
      tz: timezone || null,
    });
  }, [groupId, userId, dateFrom, dateTo, timezone]);

  useEffect(() => {
    localStorage.setItem(COLUMN_KEY, JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    if (!customFields.length) return;
    setColumns((prev) => {
      const available = new Set(customFields.map((f) => f.name));
      if (prev.customFieldNames.length === 0) {
        return { ...prev, customFieldNames: customFields.map((f) => f.name) };
      }
      const kept = prev.customFieldNames.filter((n) => available.has(n));
      if (kept.length === prev.customFieldNames.length) return prev;
      return { ...prev, customFieldNames: kept };
    });
  }, [customFields]);

  useEffect(() => {
    if (!cfMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (cfMenuRef.current && !cfMenuRef.current.contains(event.target as Node)) {
        setCfMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [cfMenuOpen]);

  useEffect(() => {
    const previous = document.title;
    document.title = "Trip detail · FM Plus";
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    if (tenantError) setBootError(tenantError);
  }, [tenantError]);

  useEffect(() => {
    if (!ready) return;
    if (userId && !allowsUser(userId)) {
      setUserId(allowedUserIds.length === 1 ? String(allowedUserIds[0]) : "");
    }
    if (groupId && !allowsGroup(groupId)) {
      setGroupId(allowedGroupIds.length === 1 ? String(allowedGroupIds[0]) : "");
    }
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    fetchGroups(ac.signal)
      .then((list) => {
        const next = allowedGroupIds.length ? list.filter((g) => allowsGroup(g.id)) : list;
        setGroups(next);
        setBootError("");
        if (!groupId && next.length === 1) setGroupId(String(next[0].id));
        if (allowedGroupIds.length === 1) setGroupId(String(allowedGroupIds[0]));
        if (allowedUserIds.length === 1) setUserId(String(allowedUserIds[0]));
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setBootError(err.message);
      });
    return () => ac.abort();
  }, [ready]);

  useEffect(() => {
    if (!selectedGroup) {
      setUsers([]);
      return;
    }
    const ac = new AbortController();
    fetchUsersForGroup(selectedGroup, ac.signal)
      .then((list) => {
        const next = allowedUserIds.length ? list.filter((u) => allowsUser(u.id)) : list;
        setUsers(next);
        if (userId && !next.some((u) => String(u.id) === userId)) setUserId("");
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setBootError(err.message);
      });
    return () => ac.abort();
  }, [selectedGroup?.id]);

  const visible = useMemo(
    () => segments.filter((s) => statusFilter[s.status]),
    [segments, statusFilter],
  );

  const hours = useMemo(() => recordedHoursFromSegments(segments), [segments]);
  const totals = useMemo(() => {
    let distance = 0;
    let fuel = 0;
    let refill = 0;
    let trips = 0;
    for (const seg of segments) {
      if (seg.status === "trip") {
        trips += 1;
        distance += seg.distanceKm;
      }
      fuel += seg.fuelUsedL;
      refill += seg.refillL;
    }
    return { distance, fuel, refill, trips, events: events.length };
  }, [segments, events]);

  async function handleLoad() {
    const id = Number(userId);
    if (!Number.isFinite(id) || id < 1) return;
    if (rangeTooLong || dayCount < 1) {
      setLoadError(`Choose a range of 1–${TRIP_DETAIL_MAX_DAYS} days.`);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setLoadError("");
    setSegments([]);
    setEvents([]);
    setSelectedId(null);
    setProgress({ phase: "days", loaded: 0, total: 1 });
    try {
      const [tripResult, fields, dayEvents] = await Promise.all([
        loadTripsForUser({
          userId: id,
          dateFrom,
          dateTo,
          timezone,
          signal: ac.signal,
          onProgress: setProgress,
        }),
        fetchUserCustomFields(id, ac.signal).catch(() => [] as CustomField[]),
        fetchEventsForUserDays(id, eachDateInclusive(dateFrom, dateTo), ac.signal).catch(() => [] as ArmadaEvent[]),
      ]);
      const next = buildTripSegments(tripResult.trips, {
        timezone,
        minSpeedKmh: DEFAULT_MIN_SPEED_KMH,
        tripBreakMin: DEFAULT_TRIP_BREAK_MIN,
      });
      setSegments(next);
      setCustomFields(fields);
      setEvents(dayEvents);
      if (groupId) writeLastVehicle(groupId, String(id));
      if (next.length === 0) setLoadError("No recorded GPS segments in this range.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setLoadError((err as Error).message || "Failed to load trip detail.");
      }
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  return (
    <div className="app trip-detail-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Trip detail</h1>
            <p>Single vehicle · chart, table & map · max {TRIP_DETAIL_MAX_DAYS} days</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="trips" />
          <div className="vehicle-chip">
            {selectedUser ? userLabel(selectedUser) : "No vehicle selected"}
            {selectedGroup ? ` · ${selectedGroup.name}` : ""}
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="td-group">Group</label>
            <select
              id="td-group"
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setUserId("");
                setSegments([]);
              }}
            >
              <option value="">
                {bootError ? "Groups unavailable" : groups.length ? "Select a group" : "Loading groups…"}
              </option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {groupOptionLabel(group)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="td-user">Vehicle</label>
            <select
              id="td-user"
              value={userId}
              disabled={!selectedGroup}
              onChange={(e) => {
                setUserId(e.target.value);
                setSegments([]);
              }}
            >
              <option value="">{selectedGroup ? "Select a vehicle" : "Choose a group first"}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {userOptionLabel(user)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="td-from">From</label>
            <input id="td-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="td-to">To</label>
            <input id="td-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="td-tz">Timezone</label>
            <select id="td-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!userId || loading || rangeTooLong}
            onClick={() => void handleLoad()}
          >
            {loading ? "Loading…" : "Load trips"}
          </button>
        </section>

        <section className="trip-detail-toolbar">
          <div className="trip-status-filters" role="group" aria-label="Segment status">
            {(["trip", "idle", "stop"] as SegmentStatus[]).map((status) => (
              <label key={status} className="trip-status-filter">
                <input
                  type="checkbox"
                  checked={statusFilter[status]}
                  onChange={(e) => setStatusFilter((prev) => ({ ...prev, [status]: e.target.checked }))}
                />
                {status[0].toUpperCase() + status.slice(1)}
              </label>
            ))}
          </div>
          <div className="trip-column-config" role="group" aria-label="Optional columns">
            <span>Optional:</span>
            <div className="trip-cf-select" ref={cfMenuRef}>
              <button
                type="button"
                className="trip-cf-select-btn"
                disabled={customFields.length === 0}
                aria-expanded={cfMenuOpen}
                aria-haspopup="listbox"
                onClick={() => setCfMenuOpen((open) => !open)}
              >
                Custom fields
                {customFields.length > 0
                  ? ` (${selectedCustomFields.length}/${customFields.length})`
                  : ""}
              </button>
              {cfMenuOpen && customFields.length > 0 && (
                <div className="trip-cf-menu" role="listbox" aria-multiselectable="true">
                  {customFields.map((cf) => {
                    const checked = columns.customFieldNames.includes(cf.name);
                    return (
                      <label key={cf.name} className="trip-cf-option">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setColumns((prev) => {
                              const set = new Set(prev.customFieldNames);
                              if (set.has(cf.name)) set.delete(cf.name);
                              else set.add(cf.name);
                              return {
                                ...prev,
                                customFieldNames: customFields
                                  .map((f) => f.name)
                                  .filter((name) => set.has(name)),
                              };
                            });
                          }}
                        />
                        <span className="trip-cf-option-label">
                          <strong>{cf.name}</strong>
                          <em>{cf.value || "—"}</em>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            {(
              [
                ["rpm", "RPM"],
                ["refill", "Refill"],
                ["events", "Event Count"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="trip-status-filter">
                <input
                  type="checkbox"
                  checked={columns[key]}
                  onChange={(e) => setColumns((prev) => ({ ...prev, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        {rangeTooLong && (
          <div className="banner warn">Trip detail is limited to {TRIP_DETAIL_MAX_DAYS} days. Narrow the date range.</div>
        )}
        {bootError && <div className="banner error">{bootError}</div>}
        {loadError && <div className="banner error">{loadError}</div>}
        {loading && progress && (
          <div className="banner progress">
            <span>{describeLoadProgress(progress)}</span>
          </div>
        )}

        {segments.length > 0 && (
          <>
            <section className="kpis trip-detail-kpis">
              <article className="kpi">
                <div className="label">Trips</div>
                <div className="value">{totals.trips}</div>
              </article>
              <article className="kpi">
                <div className="label">Distance</div>
                <div className="value">{formatKm(totals.distance)}</div>
                <div className="unit">km</div>
              </article>
              <article className="kpi">
                <div className="label">Moving</div>
                <div className="value">{formatHours(hours.tripHours)}</div>
                <div className="unit">h</div>
              </article>
              <article className="kpi">
                <div className="label">Idle / Stop</div>
                <div className="value">{formatHours(hours.idleHours + hours.stopHours)}</div>
                <div className="unit">h recorded</div>
              </article>
              <article className="kpi">
                <div className="label">Fuel</div>
                <div className="value">{formatLiters(totals.fuel)}</div>
                <div className="unit">L</div>
              </article>
              <article className="kpi">
                <div className="label">Events</div>
                <div className="value">{totals.events}</div>
              </article>
            </section>
            <p className="trip-recorded-note">
              Recorded coverage {formatHours(hours.recordedHours)} h across {dayCount} day
              {dayCount === 1 ? "" : "s"}. Time outside Trip and Idle is treated as continuous Stop/park.
            </p>

            <section className="trip-detail-chart panel">
              <h2>Timeline</h2>
              <div className="trip-timeline" role="img" aria-label="Segment timeline">
                {visible.map((seg) => (
                  <button
                    key={seg.id}
                    type="button"
                    className={`trip-timeline-seg ${seg.status}${selectedId === seg.id ? " selected" : ""}`}
                    style={{ flexGrow: Math.max(seg.durationMs, 1), background: seg.color }}
                    title={`${seg.status} · ${formatDuration(seg.durationMs)}`}
                    onClick={() => setSelectedId(seg.id === selectedId ? null : seg.id)}
                  />
                ))}
              </div>
            </section>

            <section className="trip-detail-map-wrap panel">
              <h2>Map</h2>
              <p className="trip-map-hint">Each trip has its own colour. Click a row or polyline to highlight.</p>
              <TripSegmentMap
                segments={visible}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
              />
            </section>

            <section className="panel trip-detail-table-wrap">
              <h2>Segments</h2>
              <div className="trip-detail-table-scroll">
                <table className="data-table trip-detail-table">
                  <thead>
                    <tr>
                      <th>Vehicle Name</th>
                      <th>Group</th>
                      {selectedCustomFields.map((cf) => (
                        <th key={cf.name}>{cf.name}</th>
                      ))}
                      <th>Trip Status</th>
                      <th>Start Time</th>
                      <th>End Time</th>
                      <th>Duration</th>
                      <th>Start Lat Lon</th>
                      <th>End Lat Lon</th>
                      <th>Distance</th>
                      <th>Speed</th>
                      {columns.rpm && <th>RPM</th>}
                      <th>Fuel Consumption</th>
                      {columns.refill && <th>Refill</th>}
                      {columns.events && <th>Event Count</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((seg) => {
                      const eventCount = countEventsInRange(events, seg.startMs, seg.endMs);
                      return (
                        <tr
                          key={seg.id}
                          className={selectedId === seg.id ? "selected" : ""}
                          onClick={() => setSelectedId(seg.id === selectedId ? null : seg.id)}
                        >
                          <td>
                            <span className="trip-color-dot" style={{ background: seg.color }} />
                            {selectedUser ? userLabel(selectedUser) : "—"}
                          </td>
                          <td>{selectedGroup?.name || "—"}</td>
                          {selectedCustomFields.map((cf) => (
                            <td key={cf.name}>{cf.value || "—"}</td>
                          ))}
                          <td className={`trip-status trip-status-${seg.status}`}>
                            {seg.status[0].toUpperCase() + seg.status.slice(1)}
                          </td>
                          <td>{formatWhen(seg.startMs, timezone)}</td>
                          <td>{formatWhen(seg.endMs, timezone)}</td>
                          <td>{formatDuration(seg.durationMs)}</td>
                          <td>
                            {seg.startLat !== null && seg.startLon !== null ? (
                              <a
                                href={googleMapsUrl(seg.startLat, seg.startLon)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {latLonLabel(seg.startLat, seg.startLon)}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {seg.endLat !== null && seg.endLon !== null ? (
                              <a
                                href={googleMapsUrl(seg.endLat, seg.endLon)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {latLonLabel(seg.endLat, seg.endLon)}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{seg.status === "trip" ? `${formatKm(seg.distanceKm)} km` : "—"}</td>
                          <td>
                            {seg.status === "trip"
                              ? `${formatSpeed(seg.avgSpeedKmh)} avg · ${formatSpeed(seg.maxSpeedKmh)} max`
                              : "—"}
                          </td>
                          {columns.rpm && (
                            <td>
                              {seg.avgRpm > 0 ? `${formatRpm(seg.avgRpm)} · max ${formatRpm(seg.maxRpm)}` : "—"}
                            </td>
                          )}
                          <td>
                            {seg.fuelUsedL > 0
                              ? `${formatLiters(seg.fuelUsedL)} L (${seg.fuelSource})`
                              : "—"}
                          </td>
                          {columns.refill && <td>{seg.refillL > 0 ? `${formatLiters(seg.refillL)} L` : "—"}</td>}
                          {columns.events && <td>{eventCount || "—"}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {!loading && segments.length === 0 && !loadError && (
          <section className="empty-panel">
            <h3>Load a vehicle day to see trips</h3>
            <p>
              Pick one vehicle and up to {TRIP_DETAIL_MAX_DAYS} days. Trips use moving sessions; Idle is ignition-on
              stationary; everything else between points is continuous Stop/park.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
