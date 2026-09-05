import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchGroups, fetchUsersForGroup, fetchUsersStatus, groupOptionLabel } from "../lib/api";
import { TIMEZONES } from "../lib/config";
import { formatSpeed } from "../lib/format";
import { ageLabel, filterStatusRows, type LastStatusRow } from "../lib/lastStatus";
import {
  classifyLiveRow,
  countLiveByClass,
  defaultLiveFilters,
  filterLiveRows,
  LIVE_OPS_CLASSES,
  LIVE_OPS_COLORS,
  LIVE_OPS_LABELS,
} from "../lib/liveOps";
import { fullHref, tripsHref, writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import type { Group, User } from "../lib/types";
import { BrandMark } from "../components/BrandMark";
import { LiveOpsMap } from "../components/LiveOpsMap";
import { ViewNav } from "../components/ViewNav";

function vehicleSearch(userId: number): string {
  const params = new URLSearchParams(window.location.search);
  params.set("userId", String(userId));
  params.delete("userIds");
  const q = params.toString();
  return q ? `?${q}` : "";
}

export default function LiveOps() {
  const { query, ready, error: tenantError, allowedUserIds, allowedGroupIds, allowsUser, allowsGroup } =
    useEmbedTenant();
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groupId, setGroupId] = useState(query.groupId);
  const [timezone, setTimezone] = useState(query.tz);
  const [bootError, setBootError] = useState("");
  const [rows, setRows] = useState<LastStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [filters, setFilters] = useState(defaultLiveFilters);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [queryText, setQueryText] = useState("");

  const selectedGroup = groups.find((g) => String(g.id) === groupId);

  useEffect(() => {
    writeLocationSearch({
      groupId: groupId || null,
      tz: timezone || null,
    });
  }, [groupId, timezone]);

  useEffect(() => {
    document.title = "Live Ops · FM Plus";
  }, []);

  useEffect(() => {
    if (tenantError) setBootError(tenantError);
  }, [tenantError]);

  useEffect(() => {
    if (!ready) return;
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
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setBootError(
          err.message.includes("401") || err.message.includes("403")
            ? "Could not reach Armada. Auth is injected on the server, not in this page."
            : err.message,
        );
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
        setUsers(allowedUserIds.length ? list.filter((u) => allowsUser(u.id)) : list);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setBootError(err.message);
      });
    return () => ac.abort();
  }, [selectedGroup?.id]);

  const loadStatus = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setFetchError("");
      const gid = Number(groupId);
      return fetchUsersStatus({
        groupId: Number.isFinite(gid) && gid > 0 ? gid : undefined,
        signal,
      })
        .then((next) => {
          setRows(next);
          setNow(Date.now());
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setFetchError(err.message || "Live status unavailable");
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

  const scoped = useMemo(() => {
    const ids = groupId && users.length ? users.map((u) => u.id) : undefined;
    return filterStatusRows(rows, ids);
  }, [rows, groupId, users]);

  const counts = useMemo(() => countLiveByClass(scoped, now), [scoped, now]);

  const filtered = useMemo(() => {
    const byClass = filterLiveRows(scoped, filters, now);
    const q = queryText.trim().toLowerCase();
    if (!q) return byClass;
    return byClass.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        String(row.id).includes(q),
    );
  }, [scoped, filters, now, queryText]);

  const mapped = useMemo(
    () => filtered.filter((r) => r.lat !== null && r.lon !== null),
    [filtered],
  );

  const fitKey = `${groupId}|${LIVE_OPS_CLASSES.map((c) => (filters[c] ? "1" : "0")).join("")}|${queryText}`;

  const onSelect = useCallback((id: number | null) => setSelectedId(id), []);

  return (
    <div className="app live-ops-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Live Ops</h1>
            <p>Fleet positions · Moving / Idle / Off / Stale / No fix</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="live" />
          <div className="vehicle-chip">
            {loading ? "Updating…" : `${filtered.length} shown`}
            {selectedGroup ? ` · ${selectedGroup.name}` : " · All devices"}
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="live-group">Group</label>
            <select id="live-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">
                {bootError ? "Groups unavailable" : groups.length ? "All devices" : "Loading groups…"}
              </option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {groupOptionLabel(group)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="live-tz">Timezone</label>
            <select id="live-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="live-q">Search</label>
            <input
              id="live-q"
              type="search"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Name or id"
            />
          </div>
          <div className="field field-actions">
            <label>&nbsp;</label>
            <button type="button" className="btn" disabled={loading} onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
          </div>
        </section>

        <div className="live-ops-filters" role="group" aria-label="Ops class filters">
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
            <h2>Vehicles</h2>
            {filtered.length === 0 ? (
              <p className="muted">{loading ? "Loading…" : "No vehicles match filters."}</p>
            ) : (
              <ul>
                {filtered.map((row) => {
                  const cls = classifyLiveRow(row, now);
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={selectedId === row.id ? "active" : ""}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <span className="live-ops-swatch" style={{ background: LIVE_OPS_COLORS[cls] }} />
                        <span className="live-ops-list-main">
                          <strong>{row.name}</strong>
                          <span className="muted">
                            {LIVE_OPS_LABELS[cls]} · {ageLabel(row.lastMs, now)} ·{" "}
                            {row.speedKmh === null ? "—" : `${formatSpeed(row.speedKmh)} km/h`}
                          </span>
                        </span>
                      </button>
                      <div className="live-ops-list-links">
                        <a href={tripsHref(vehicleSearch(row.id))}>Trips</a>
                        <a href={fullHref(vehicleSearch(row.id))}>Full</a>
                      </div>
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
