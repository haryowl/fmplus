import { useEffect, useMemo, useState } from "react";
import { fetchGroups, fetchUsersForGroup, fetchUsersStatus, groupOptionLabel } from "../lib/api";
import { TIMEZONES } from "../lib/config";
import {
  ackException,
  derivedStaleExceptions,
  downloadExceptionsExcel,
  exceptionGeofenceName,
  exceptionSourceLabel,
  exceptionTitle,
  exceptionTrackerDeviceId,
  exceptionUserId,
  exceptionWhen,
  fetchExceptions,
  filterExceptionsByGroup,
  unackException,
  type ExceptionItem,
  type ExceptionStatusFilter,
} from "../lib/exceptions";
import { filterStatusRows, type LastStatusRow } from "../lib/lastStatus";
import {
  deviceIdByStatusRowId,
  fetchDeviceGroupScope,
  fetchTrackerDeviceGroups,
  fetchTrackerLastStatus,
  mergeArmadaRowsWithDeviceFixes,
  type TrackerDeviceGroup,
} from "../lib/trackerDevices";
import { vehicleTrackHref, writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import type { Group, User } from "../lib/types";
import { BrandMark } from "../components/BrandMark";
import { ViewNav } from "../components/ViewNav";

export default function ExceptionsInbox() {
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
  const [deviceGroups, setDeviceGroups] = useState<TrackerDeviceGroup[]>([]);
  const [groupId, setGroupId] = useState(query.groupId);
  const [deviceGroupId, setDeviceGroupId] = useState(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    return params.get("deviceGroupId") || "";
  });
  const [deviceGroupDeviceIds, setDeviceGroupDeviceIds] = useState<string[] | undefined>();
  const [deviceGroupArmadaIds, setDeviceGroupArmadaIds] = useState<number[] | undefined>();
  const [timezone, setTimezone] = useState(query.tz);
  const [bootError, setBootError] = useState("");
  const [statusFilter, setStatusFilter] = useState<ExceptionStatusFilter>("open");
  const [items, setItems] = useState<ExceptionItem[]>([]);
  const [derived, setDerived] = useState<ExceptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showDerived, setShowDerived] = useState(true);
  const [queryText, setQueryText] = useState("");
  const [deviceIdByUserId, setDeviceIdByUserId] = useState<Map<number, string>>(() => new Map());
  const [telematicsSource, setTelematicsSource] = useState<"armada" | "devices" | "both">("both");

  const selectedGroup = groups.find((g) => String(g.id) === groupId);
  const excelOk = entitlements.features.excel !== false;

  useEffect(() => {
    writeLocationSearch({
      groupId: deviceGroupId ? null : groupId || null,
      deviceGroupId: deviceGroupId || null,
      tz: timezone || null,
    });
  }, [groupId, deviceGroupId, timezone]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    fetchTrackerDeviceGroups(ac.signal)
      .then((list) => setDeviceGroups(list))
      .catch(() => setDeviceGroups([]));
    return () => ac.abort();
  }, [ready]);

  useEffect(() => {
    document.title = "Exceptions · ARMADA M.1";
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
        setGroups([]);
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
        if (err.name !== "AbortError") setUsers([]);
      });
    return () => ac.abort();
  }, [selectedGroup?.id]);

  useEffect(() => {
    if (!ready) return;
    if (!query.tenantKey) {
      setError("Open this page with k= (embed tenant key) to load notifier exceptions.");
      setLoading(false);
      setItems([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError("");
    void fetchExceptions(statusFilter, ac.signal)
      .then((list) => setItems(list))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [ready, query.tenantKey, statusFilter, reload]);

  // Always load device↔user map so notifier Trips/Full can deep-link without derived stale.
  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    void Promise.all([
      fetchTrackerLastStatus(ac.signal, {
        groupIds: deviceGroupId ? [deviceGroupId] : undefined,
      }).catch((err: Error) => {
        if (err.name === "AbortError") throw err;
        return { fixes: [], telematicsSource: "both" as const };
      }),
      deviceGroupId
        ? fetchDeviceGroupScope([deviceGroupId], ac.signal).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([deviceStatus, scope]) => {
        if (ac.signal.aborted) return;
        setDeviceIdByUserId(deviceIdByStatusRowId(deviceStatus.fixes));
        setTelematicsSource(deviceStatus.telematicsSource || "both");
        setDeviceGroupDeviceIds(deviceGroupId ? scope?.deviceIds || [] : undefined);
        setDeviceGroupArmadaIds(deviceGroupId ? scope?.armadaUserIds || [] : undefined);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          /* optional enrichment */
        }
      });
    return () => ac.abort();
  }, [ready, deviceGroupId, reload]);

  useEffect(() => {
    if (!ready || !showDerived || statusFilter === "acked") {
      setDerived([]);
      return;
    }
    const ac = new AbortController();
    const gid = Number(groupId);
    void Promise.all([
      fetchUsersStatus({
        groupId:
          !deviceGroupId && Number.isFinite(gid) && gid > 0 ? gid : undefined,
        signal: ac.signal,
      }).catch((err: Error) => {
        if (err.name === "AbortError") throw err;
        return [] as LastStatusRow[];
      }),
      fetchTrackerLastStatus(ac.signal, {
        groupIds: deviceGroupId ? [deviceGroupId] : undefined,
      }).catch((err: Error) => {
        if (err.name === "AbortError") throw err;
        return { fixes: [], telematicsSource: "both" as const };
      }),
      deviceGroupId
        ? fetchDeviceGroupScope([deviceGroupId], ac.signal).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([armadaRows, deviceStatus, scope]) => {
        const byDevice = deviceIdByStatusRowId(deviceStatus.fixes);
        setDeviceIdByUserId(byDevice);
        setTelematicsSource(deviceStatus.telematicsSource || "both");
        setDeviceGroupDeviceIds(deviceGroupId ? scope?.deviceIds || [] : undefined);
        setDeviceGroupArmadaIds(deviceGroupId ? scope?.armadaUserIds || [] : undefined);
        let merged: LastStatusRow[];
        if (deviceGroupId) {
          const allow = new Set(scope?.armadaUserIds || []);
          const armadaScoped = allow.size
            ? armadaRows.filter((r) => allow.has(r.id))
            : [];
          merged = mergeArmadaRowsWithDeviceFixes(
            armadaScoped,
            deviceStatus.fixes,
            deviceStatus.telematicsSource === "armada"
              ? "devices"
              : deviceStatus.telematicsSource,
          );
        } else {
          merged = mergeArmadaRowsWithDeviceFixes(
            armadaRows,
            deviceStatus.fixes,
            deviceStatus.telematicsSource,
          );
          const ids =
            groupId && users.length
              ? users.map((u) => u.id)
              : allowedUserIds.length
                ? allowedUserIds
                : undefined;
          if (deviceStatus.telematicsSource !== "devices" && ids?.length) {
            merged = filterStatusRows(merged, ids);
          }
        }
        setNow(Date.now());
        setDerived(derivedStaleExceptions(merged, Date.now(), byDevice));
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          /* derived is secondary — ignore soft failures */
        }
      });
    return () => ac.abort();
  }, [ready, showDerived, statusFilter, groupId, deviceGroupId, users, allowedUserIds, reload]);

  const scopeUserIds = useMemo(() => {
    if (deviceGroupId) return deviceGroupArmadaIds?.length ? deviceGroupArmadaIds : undefined;
    if (groupId && users.length) return users.map((u) => u.id);
    if (allowedUserIds.length) return allowedUserIds;
    return undefined;
  }, [groupId, users, allowedUserIds, deviceGroupId, deviceGroupArmadaIds]);

  const scopeUsernames = useMemo(
    () =>
      !deviceGroupId && groupId && users.length
        ? users.map((u) => u.username || "").filter(Boolean)
        : undefined,
    [groupId, users, deviceGroupId],
  );

  const list = useMemo(() => {
    const notify = items;
    const extra = showDerived && statusFilter !== "acked" ? derived : [];
    let merged = [...notify, ...extra];
    if (scopeUserIds?.length || scopeUsernames?.length || deviceGroupDeviceIds?.length) {
      merged = filterExceptionsByGroup(merged, {
        userIds: scopeUserIds,
        usernames: scopeUsernames,
        deviceIds: deviceGroupDeviceIds,
      });
    }
    const q = queryText.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(
      (item) =>
        exceptionTitle(item).toLowerCase().includes(q) ||
        exceptionGeofenceName(item).toLowerCase().includes(q) ||
        exceptionSourceLabel(item).toLowerCase().includes(q) ||
        (item.userDisplayName || "").toLowerCase().includes(q) ||
        (item.armadaUsername || "").toLowerCase().includes(q) ||
        String(exceptionUserId(item) ?? "").includes(q),
    );
  }, [
    items,
    derived,
    showDerived,
    statusFilter,
    scopeUserIds,
    scopeUsernames,
    deviceGroupDeviceIds,
    queryText,
  ]);

  async function onAck(id: string) {
    setBusyId(id);
    setError("");
    try {
      const updated = await ackException(id);
      setItems((prev) =>
        statusFilter === "open" ? prev.filter((x) => x.id !== id) : prev.map((x) => (x.id === id ? updated : x)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ack failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onUnack(id: string) {
    setBusyId(id);
    setError("");
    try {
      const updated = await unackException(id);
      setItems((prev) =>
        statusFilter === "acked" ? prev.filter((x) => x.id !== id) : prev.map((x) => (x.id === id ? updated : x)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unack failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="app exceptions-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Exceptions</h1>
            <p>Command notifier, Fleet Live rules, and derived stale positions</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="exceptions" />
          <div className="vehicle-chip">
            {loading ? "Loading…" : `${list.length} items`}
            {deviceGroupId
              ? ` · ${deviceGroups.find((g) => g.id === deviceGroupId)?.name || "Device group"}`
              : selectedGroup
                ? ` · ${selectedGroup.name}`
                : " · All devices"}
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="exc-device-group">Device group</label>
            <select
              id="exc-device-group"
              value={deviceGroupId}
              onChange={(e) => {
                setDeviceGroupId(e.target.value);
                if (e.target.value) setGroupId("");
              }}
            >
              <option value="">
                {deviceGroups.length ? "All device groups" : "No device groups"}
              </option>
              {deviceGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="exc-group">Group</label>
            <select
              id="exc-group"
              value={groupId}
              disabled={Boolean(deviceGroupId)}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">
                {deviceGroupId
                  ? "Using device group"
                  : groups.length
                    ? "All devices"
                    : "No Armada groups"}
              </option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {groupOptionLabel(group)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="exc-tz">Timezone</label>
            <select id="exc-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="exc-status">Status</label>
            <select
              id="exc-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ExceptionStatusFilter)}
            >
              <option value="open">Open</option>
              <option value="acked">Acked</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="exc-q">Search</label>
            <input
              id="exc-q"
              type="search"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Rule, vehicle, id"
            />
          </div>
          <div className="field field-actions">
            <label>&nbsp;</label>
            <button type="button" className="btn" disabled={loading} onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
          </div>
          {excelOk ? (
            <div className="field field-actions">
              <label>&nbsp;</label>
              <button
                type="button"
                className="btn-ghost"
                disabled={!list.length}
                onClick={() => downloadExceptionsExcel(list, now)}
              >
                Excel
              </button>
            </div>
          ) : null}
        </section>

        <label className="exceptions-derived-toggle">
          <input type="checkbox" checked={showDerived} onChange={(e) => setShowDerived(e.target.checked)} />
          Include derived stale from Live Status
        </label>

        {(bootError || error) && <div className="banner error">{bootError || error}</div>}

        <ul className="exceptions-list">
          {list.length === 0 && !loading && (
            <li className="muted exceptions-empty">
              {query.tenantKey
                ? "No exceptions yet. Wire Command notifier, add Fleet Live alert rules, or wait for stale GPS positions."
                : "Add k= to the URL."}
            </li>
          )}
          {list.map((item) => {
            const uid = exceptionUserId(item);
            const rowId = item.userId != null && item.userId !== 0 ? item.userId : uid;
            const deviceId =
              exceptionTrackerDeviceId(item) ||
              (uid != null ? deviceIdByUserId.get(uid) : null) ||
              (rowId != null && rowId < 0 ? deviceIdByUserId.get(rowId) : null) ||
              null;
            const canLink = (rowId != null && rowId !== 0) || Boolean(deviceId);
            return (
              <li key={item.id} className={item.ackedAt ? "acked" : "open"}>
                <div className="exceptions-row-main">
                  <strong>{exceptionTitle(item)}</strong>
                  {exceptionGeofenceName(item) ? (
                    <span className="exceptions-fence">Fence: {exceptionGeofenceName(item)}</span>
                  ) : null}
                  <span className="muted">
                    {exceptionSourceLabel(item)} · {exceptionWhen(item, now)}
                    {item.userDisplayName || item.armadaUsername
                      ? ` · ${item.userDisplayName || item.armadaUsername}`
                      : ""}
                  </span>
                  {item.ackedNote ? <span className="muted">Note: {item.ackedNote}</span> : null}
                </div>
                <div className="exceptions-row-actions">
                  {canLink ? (
                    <>
                      <a
                        className="btn-ghost"
                        href={vehicleTrackHref({
                          rowId: rowId || 0,
                          deviceId,
                          kind: "trips",
                          telematicsSource,
                        })}
                      >
                        Trips
                      </a>
                      <a
                        className="btn-ghost"
                        href={vehicleTrackHref({
                          rowId: rowId || 0,
                          deviceId,
                          kind: "full",
                          telematicsSource,
                        })}
                      >
                        Full
                      </a>
                    </>
                  ) : (
                    <span className="muted">No vehicle link</span>
                  )}
                  {item.source !== "derived" && !item.ackedAt && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === item.id}
                      onClick={() => void onAck(item.id)}
                    >
                      Ack
                    </button>
                  )}
                  {item.source !== "derived" && item.ackedAt && (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busyId === item.id}
                      onClick={() => void onUnack(item.id)}
                    >
                      Unack
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
