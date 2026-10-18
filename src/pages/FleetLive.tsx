import { useCallback, useEffect, useMemo, useState } from "react";
import { TIMEZONES } from "../lib/config";
import { formatKm, formatSpeed } from "../lib/format";
import { ageLabel, type LastStatusRow } from "../lib/lastStatus";
import {
  classifyLiveRow,
  countLiveByClass,
  defaultLiveFilters,
  filterLiveRows,
  LIVE_OPS_CLASSES,
  LIVE_OPS_COLORS,
  LIVE_OPS_LABELS,
} from "../lib/liveOps";
import { fullHref, liveHref, maintenanceHref, tripsHref, writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import {
  fetchTrackerDeviceGroups,
  fetchTrackerLastStatus,
  trackerFixToStatusRow,
  type TrackerDeviceGroup,
} from "../lib/trackerDevices";
import { BrandMark } from "../components/BrandMark";
import { LiveOpsMap } from "../components/LiveOpsMap";
import { ViewNav } from "../components/ViewNav";

function vehicleSearch(userId: number): string {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  params.set("userId", String(userId));
  params.delete("userIds");
  const q = params.toString();
  return q ? `?${q}` : "";
}

function maintenanceOpenHref(userId: number): string {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  params.set("userId", String(userId));
  params.set("open", "1");
  params.delete("userIds");
  const q = params.toString();
  return maintenanceHref(q ? `?${q}` : "?open=1");
}

/**
 * Device-native fleet live map (tracker last-fix). Separate from Armada `/live`.
 */
export default function FleetLive() {
  const { query, ready, error: tenantError } = useEmbedTenant();
  const [deviceGroups, setDeviceGroups] = useState<TrackerDeviceGroup[]>([]);
  const [groupId, setGroupId] = useState(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    return params.get("deviceGroupId") || "";
  });
  const [timezone, setTimezone] = useState(query.tz);
  const [bootError, setBootError] = useState("");
  const [rows, setRows] = useState<LastStatusRow[]>([]);
  const [fixMeta, setFixMeta] = useState<
    Record<number, { imei: string; odometerKm: number | null; groups: string }>
  >({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [filters, setFilters] = useState(defaultLiveFilters);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [queryText, setQueryText] = useState("");

  const selectedGroup = deviceGroups.find((g) => g.id === groupId);

  useEffect(() => {
    writeLocationSearch({
      deviceGroupId: groupId || null,
      tz: timezone || null,
    });
  }, [groupId, timezone]);

  useEffect(() => {
    document.title = "Fleet Live · ARMADA M.1";
  }, []);

  useEffect(() => {
    if (tenantError) setBootError(tenantError);
  }, [tenantError]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    fetchTrackerDeviceGroups(ac.signal)
      .then((list) => {
        setDeviceGroups(list);
        setBootError("");
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setDeviceGroups([]);
      });
    return () => ac.abort();
  }, [ready, reload]);

  const loadStatus = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setFetchError("");
      return fetchTrackerLastStatus(signal, {
        groupIds: groupId ? [groupId] : undefined,
      })
        .then((deviceStatus) => {
          const nextRows = deviceStatus.fixes.map(trackerFixToStatusRow);
          const meta: Record<number, { imei: string; odometerKm: number | null; groups: string }> =
            {};
          for (const fix of deviceStatus.fixes) {
            const row = trackerFixToStatusRow(fix);
            meta[row.id] = {
              imei: fix.imei,
              odometerKm: fix.odometerKm ?? null,
              groups: (fix.groups || []).map((g) => g.name).join(", "),
            };
          }
          setRows(nextRows);
          setFixMeta(meta);
          setNow(Date.now());
          if (deviceStatus.telematicsSource === "armada") {
            setFetchError("Tenant telematics_source is Armada-only — enable devices or both.");
          }
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setFetchError(err.message || "Fleet live unavailable");
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [groupId],
  );

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    void loadStatus(ac.signal);
    return () => ac.abort();
  }, [ready, groupId, reload, loadStatus]);

  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      void loadStatus();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [ready, loadStatus]);

  const counts = useMemo(() => countLiveByClass(rows, now), [rows, now]);

  const filtered = useMemo(() => {
    const byClass = filterLiveRows(rows, filters, now);
    const q = queryText.trim().toLowerCase();
    if (!q) return byClass;
    return byClass.filter((row) => {
      const meta = fixMeta[row.id];
      return (
        row.name.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        String(row.id).includes(q) ||
        (meta?.imei && meta.imei.toLowerCase().includes(q)) ||
        (meta?.groups && meta.groups.toLowerCase().includes(q))
      );
    });
  }, [rows, filters, now, queryText, fixMeta]);

  const mapped = useMemo(
    () => filtered.filter((r) => r.lat !== null && r.lon !== null),
    [filtered],
  );

  const fitKey = `${groupId}|${LIVE_OPS_CLASSES.map((c) => (filters[c] ? "1" : "0")).join("")}|${queryText}`;

  const onSelect = useCallback((id: number | null) => setSelectedId(id), []);

  function setAllClassFilters(on: boolean) {
    setFilters({
      moving: on,
      idle: on,
      off: on,
      stale: on,
      noFix: on,
    });
  }

  return (
    <div className="app live-ops-page fleet-live-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Fleet Live</h1>
            <p>Tracker devices · odometer / fuel · separate from Armada Live</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="fleetLive" />
          <div className="vehicle-chip">
            {loading ? "Updating…" : `${filtered.length} shown`}
            {selectedGroup ? ` · ${selectedGroup.name}` : " · All devices"}
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="fleet-live-group">Device group</label>
            <select
              id="fleet-live-group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">
                {deviceGroups.length ? "All devices" : "No groups yet"}
              </option>
              {deviceGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                  {group.memberCount != null ? ` (${group.memberCount})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fleet-live-tz">Timezone</label>
            <select
              id="fleet-live-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fleet-live-q">Search</label>
            <input
              id="fleet-live-q"
              type="search"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Label, IMEI, group"
            />
          </div>
          <div className="field field-actions">
            <label>&nbsp;</label>
            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={() => setReload((n) => n + 1)}
            >
              Refresh
            </button>
          </div>
          <div className="field field-actions">
            <label>&nbsp;</label>
            <a className="btn-ghost" href={liveHref(typeof window !== "undefined" ? window.location.search : "")}>
              Armada Live
            </a>
          </div>
        </section>

        <div className="live-ops-filters" role="group" aria-label="Ops class filters">
          <div className="live-ops-filter-tools">
            <button type="button" className="btn-link" onClick={() => setAllClassFilters(true)}>
              All classes
            </button>
            <button type="button" className="btn-link" onClick={() => setAllClassFilters(false)}>
              Clear
            </button>
          </div>
          {LIVE_OPS_CLASSES.map((cls) => (
            <label key={cls} className="live-ops-filter">
              <input
                type="checkbox"
                checked={filters[cls]}
                onChange={(e) => setFilters((prev) => ({ ...prev, [cls]: e.target.checked }))}
              />
              <span className="live-ops-swatch" style={{ background: LIVE_OPS_COLORS[cls] }} />
              <span>
                {LIVE_OPS_LABELS[cls]} ({counts[cls]})
              </span>
            </label>
          ))}
        </div>

        {(bootError || fetchError) && (
          <div className="banner error">{bootError || fetchError}</div>
        )}

        <div className="live-ops-layout">
          <div className="live-ops-map-wrap map-wrap">
            <LiveOpsMap
              rows={mapped}
              now={now}
              fitKey={fitKey}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </div>
          <aside className="live-ops-list">
            <h2>Devices</h2>
            {filtered.length === 0 ? (
              <p className="muted">{loading ? "Loading…" : "No devices match filters."}</p>
            ) : (
              <ul>
                {filtered.map((row) => {
                  const cls = classifyLiveRow(row, now);
                  const meta = fixMeta[row.id];
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={selectedId === row.id ? "active" : ""}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <span
                          className="live-ops-swatch"
                          style={{ background: LIVE_OPS_COLORS[cls] }}
                        />
                        <span className="live-ops-list-main">
                          <strong>{row.name}</strong>
                          <span className="muted">
                            {LIVE_OPS_LABELS[cls]} · {ageLabel(row.lastMs, now)} ·{" "}
                            {row.speedKmh === null ? "—" : `${formatSpeed(row.speedKmh)} km/h`}
                            {meta?.odometerKm != null
                              ? ` · ${formatKm(meta.odometerKm)} km`
                              : ""}
                            {row.fuelLevel != null ? ` · fuel ${Math.round(row.fuelLevel)}%` : ""}
                          </span>
                          {meta?.groups ? (
                            <span className="muted">{meta.groups}</span>
                          ) : null}
                        </span>
                      </button>
                      {row.id > 0 ? (
                        <div className="live-ops-list-links">
                          <a href={tripsHref(vehicleSearch(row.id))}>Trips</a>
                          <a href={fullHref(vehicleSearch(row.id))}>Full</a>
                          <a href={maintenanceOpenHref(row.id)}>Maintenance</a>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
