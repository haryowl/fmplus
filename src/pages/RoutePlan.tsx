import { useEffect, useMemo, useState } from "react";
import { fetchGroups, fetchUsersForGroup, fetchUsersStatus, groupOptionLabel, userOptionLabel } from "../lib/api";
import { BrandMark } from "../components/BrandMark";
import { RoutePlanMap } from "../components/RoutePlanMap";
import { ViewNav } from "../components/ViewNav";
import { formatKm } from "../lib/format";
import { filterStatusRows } from "../lib/lastStatus";
import {
  downloadRoutePlanExcel,
  fetchRoutePlanStatus,
  formatRouteDuration,
  optimizeRoutePlan,
  type RouteOptimizeResult,
  type RoutePoint,
} from "../lib/routePlan";
import { writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import type { Group, User } from "../lib/types";

export default function RoutePlanPage() {
  const {
    query,
    ready,
    error: tenantError,
    entitlements,
    allowedUserIds,
    allowedGroupIds,
    allowsUser,
    allowsGroup,
  } = useEmbedTenant();
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groupId, setGroupId] = useState(query.groupId);
  const [userId, setUserId] = useState(query.userId);
  const [bootError, setBootError] = useState("");
  const [osrmConfigured, setOsrmConfigured] = useState(false);
  const [osrmReachable, setOsrmReachable] = useState(false);
  const [osrmError, setOsrmError] = useState("");
  const [start, setStart] = useState<RoutePoint | null>(null);
  const [stops, setStops] = useState<RoutePoint[]>([]);
  const [paste, setPaste] = useState("");
  const [roundtrip, setRoundtrip] = useState(false);
  const [result, setResult] = useState<RouteOptimizeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fitKey, setFitKey] = useState("boot");

  const selectedGroup = groups.find((g) => String(g.id) === groupId);
  const excelOk = entitlements.features.excel !== false;

  useEffect(() => {
    document.title = "Route plan · FM Plus";
  }, []);

  useEffect(() => {
    writeLocationSearch({
      groupId: groupId || null,
      userId: userId || null,
    });
  }, [groupId, userId]);

  useEffect(() => {
    if (tenantError) setBootError(tenantError);
  }, [tenantError]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    fetchRoutePlanStatus(ac.signal)
      .then((s) => {
        setOsrmConfigured(s.osrmConfigured);
        setOsrmReachable(Boolean(s.osrmReachable));
        setOsrmError(s.osrmError || "");
      })
      .catch(() => {
        setOsrmConfigured(false);
        setOsrmReachable(false);
      });
    return () => ac.abort();
  }, [ready]);

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
        if (err.name !== "AbortError") setBootError(err.message);
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

  useEffect(() => {
    if (!userId) {
      setStart(null);
      return;
    }
    const id = Number(userId);
    if (!Number.isInteger(id) || id < 1) return;
    const ac = new AbortController();
    const gid = Number(groupId);
    void fetchUsersStatus({
      groupId: Number.isFinite(gid) && gid > 0 ? gid : undefined,
      signal: ac.signal,
    })
      .then((rows) => {
        const scoped = filterStatusRows(rows, [id]);
        const row = scoped[0] || rows.find((r) => r.id === id);
        if (!row || row.lat == null || row.lon == null) {
          setStart(null);
          setError("Selected vehicle has no last position — pick another or set start manually.");
          return;
        }
        setError("");
        setStart({
          lat: row.lat,
          lon: row.lon,
          label: row.name || `Vehicle ${id}`,
          id: String(id),
        });
        setResult(null);
        setFitKey(`start-${id}-${row.lat}-${row.lon}`);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => ac.abort();
  }, [userId, groupId]);

  function addStop(lat: number, lon: number, label?: string) {
    setStops((prev) => [
      ...prev,
      {
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        label: label || `Stop ${prev.length + 1}`,
      },
    ]);
    setResult(null);
    setFitKey(`stop-${Date.now()}`);
  }

  function onPasteStops() {
    const lines = paste.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
    let added = 0;
    for (const line of lines) {
      const parts = line.split(/[,|\s]+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const lat = Number(parts[0]);
      const lon = Number(parts[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const label = parts.slice(2).join(" ") || undefined;
      addStop(lat, lon, label);
      added += 1;
    }
    if (!added) setError("Paste lines like: -6.2, 106.8 Depot A");
    else setPaste("");
  }

  async function onOptimize() {
    if (!start) {
      setError("Choose a vehicle with a last position (start).");
      return;
    }
    if (!stops.length) {
      setError("Add at least one stop (click map or paste lat,lon).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await optimizeRoutePlan({ start, stops, roundtrip });
      setResult(next);
      setFitKey(`opt-${Date.now()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const draftStops = useMemo(() => stops, [stops]);

  return (
    <div className="app route-plan-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Route plan</h1>
            <p>
              Optimize stop order ·{" "}
              {osrmReachable ? "OSRM roads" : osrmConfigured ? "OSRM set but unreachable" : "straight-line estimate"}{" "}
              · not live navigation
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="routePlan" />
          <div className="vehicle-chip">
            {result
              ? `${formatKm(result.totalDistanceKm)} · ${formatRouteDuration(result.totalDurationSec)}`
              : `${stops.length} stop${stops.length === 1 ? "" : "s"}`}
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="filters route-plan-toolbar">
          <div className="field">
            <label htmlFor="rp-group">Group</label>
            <select id="rp-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">{groups.length ? "Select group" : "Loading…"}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {groupOptionLabel(g)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rp-user">Vehicle (start)</label>
            <select
              id="rp-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={!users.length}
            >
              <option value="">{users.length ? "Select vehicle" : "Pick a group"}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {userOptionLabel(u)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <label className="route-plan-roundtrip">
              <input
                type="checkbox"
                checked={roundtrip}
                onChange={(e) => {
                  setRoundtrip(e.target.checked);
                  setResult(null);
                }}
              />
              Roundtrip
            </label>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button type="button" className="btn" disabled={busy} onClick={() => void onOptimize()}>
              {busy ? "Optimizing…" : "Optimize"}
            </button>
          </div>
          {excelOk && result ? (
            <div className="field">
              <label>&nbsp;</label>
              <button type="button" className="btn-ghost" onClick={() => downloadRoutePlanExcel(result)}>
                Excel
              </button>
            </div>
          ) : null}
        </section>

        {(bootError || error) && <div className="banner error">{bootError || error}</div>}
        {!osrmConfigured ? (
          <div className="banner warn">
            OSRM not configured (`OSRM_BASE_URL`). Order still optimizes with straight-line distances — see{" "}
            <code>docs/osrm.md</code>.
          </div>
        ) : !osrmReachable ? (
          <div className="banner warn">
            `OSRM_BASE_URL` is set but OSRM is not reachable
            {osrmError ? `: ${osrmError}` : ""}. Start the container (`scripts/setup-osrm.sh`) or FM Plus will use
            haversine.
          </div>
        ) : null}
        {result?.warning ? <div className="banner warn">{result.warning}</div> : null}

        <div className="route-plan-layout">
          <div className="route-plan-map-wrap map-wrap">
            <RoutePlanMap
              start={start}
              draftStops={draftStops}
              ordered={result?.orderedStops || null}
              geometry={result?.geometry || []}
              fitKey={fitKey}
              onMapClick={(lat, lon) => addStop(lat, lon)}
            />
            <p className="muted route-plan-map-hint">Click the map to add a stop.</p>
          </div>

          <aside className="route-plan-side">
            <section className="places-panel">
              <h2>Stops</h2>
              <div className="route-plan-paste">
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={"Paste lat,lon label per line\n-6.2088, 106.8456 Depot"}
                  rows={3}
                />
                <button type="button" className="btn-ghost" onClick={onPasteStops}>
                  Add pasted
                </button>
              </div>
              {!stops.length ? (
                <p className="muted">No stops yet.</p>
              ) : (
                <ol className="route-plan-stop-list">
                  {stops.map((s, i) => (
                    <li key={`${s.lat}-${s.lon}-${i}`}>
                      <span>
                        <strong>{s.label || `Stop ${i + 1}`}</strong>
                        <span className="muted">
                          {" "}
                          · {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => {
                          setStops((prev) => prev.filter((_, j) => j !== i));
                          setResult(null);
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {stops.length ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setStops([]);
                    setResult(null);
                  }}
                >
                  Clear stops
                </button>
              ) : null}
            </section>

            {result ? (
              <section className="places-panel">
                <h2>Optimized sequence</h2>
                <p className="muted">
                  {result.engine.toUpperCase()} · {formatKm(result.totalDistanceKm)}
                  {result.totalDurationSec != null
                    ? ` · ${formatRouteDuration(result.totalDurationSec)}`
                    : ""}
                </p>
                <ol className="route-plan-stop-list">
                  {result.orderedStops.map((s) => (
                    <li key={`${s.role}-${s.seq}`}>
                      <span>
                        <strong>
                          {s.seq + 1}. {s.label || s.role}
                        </strong>
                        <span className="muted"> · {s.role}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  );
}
