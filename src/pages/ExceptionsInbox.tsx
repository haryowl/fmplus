import { useEffect, useMemo, useState } from "react";
import { fetchGroups, fetchUsersForGroup, fetchUsersStatus, groupOptionLabel } from "../lib/api";
import { TIMEZONES } from "../lib/config";
import {
  ackException,
  derivedStaleExceptions,
  exceptionTitle,
  exceptionWhen,
  fetchExceptions,
  unackException,
  type ExceptionItem,
  type ExceptionStatusFilter,
} from "../lib/exceptions";
import { filterStatusRows } from "../lib/lastStatus";
import { fullHref, tripsHref, writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import type { Group, User } from "../lib/types";
import { BrandMark } from "../components/BrandMark";
import { ViewNav } from "../components/ViewNav";

function vehicleSearch(userId: number | null | undefined, username?: string): string {
  const params = new URLSearchParams(window.location.search);
  if (userId) {
    params.set("userId", String(userId));
    params.delete("userIds");
  } else if (username) {
    // Best-effort: Full/Trips need numeric id; keep username out of userId.
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}

function payloadUserId(item: ExceptionItem): number | null {
  if (item.userId) return item.userId;
  const p = item.payload || {};
  const raw = p.USER_ID ?? p.userId ?? p.UserId;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function ExceptionsInbox() {
  const { query, ready, error: tenantError, allowedUserIds, allowedGroupIds, allowsUser, allowsGroup } =
    useEmbedTenant();
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groupId, setGroupId] = useState(query.groupId);
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

  const selectedGroup = groups.find((g) => String(g.id) === groupId);

  useEffect(() => {
    writeLocationSearch({ groupId: groupId || null, tz: timezone || null });
  }, [groupId, timezone]);

  useEffect(() => {
    document.title = "Exceptions · FM Plus";
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
        setUsers(allowedUserIds.length ? list.filter((u) => allowsUser(u.id)) : list);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setBootError(err.message);
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

  useEffect(() => {
    if (!ready || !showDerived || statusFilter === "acked") {
      setDerived([]);
      return;
    }
    const ac = new AbortController();
    const gid = Number(groupId);
    void fetchUsersStatus({
      groupId: Number.isFinite(gid) && gid > 0 ? gid : undefined,
      signal: ac.signal,
    })
      .then((rows) => {
        const ids = groupId && users.length ? users.map((u) => u.id) : undefined;
        const scoped = filterStatusRows(rows, ids);
        setNow(Date.now());
        setDerived(derivedStaleExceptions(scoped, Date.now()));
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          /* derived is secondary — ignore soft failures */
        }
      });
    return () => ac.abort();
  }, [ready, showDerived, statusFilter, groupId, users, reload]);

  const list = useMemo(() => {
    const notify = items;
    const extra = showDerived && statusFilter !== "acked" ? derived : [];
    return [...notify, ...extra];
  }, [items, derived, showDerived, statusFilter]);

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
            <p>Armada Command notifier + derived stale positions</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="exceptions" />
          <div className="vehicle-chip">{loading ? "Loading…" : `${list.length} items`}</div>
        </div>
      </header>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="exc-group">Group</label>
            <select id="exc-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
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
          <div className="field field-actions">
            <label>&nbsp;</label>
            <button type="button" className="btn" disabled={loading} onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
          </div>
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
                ? "No exceptions yet. Wire Armada Command notifier or wait for stale devices."
                : "Add k= to the URL."}
            </li>
          )}
          {list.map((item) => {
            const uid = payloadUserId(item);
            const search = vehicleSearch(uid);
            return (
              <li key={item.id} className={item.ackedAt ? "acked" : "open"}>
                <div className="exceptions-row-main">
                  <strong>{exceptionTitle(item)}</strong>
                  <span className="muted">
                    {item.source === "derived" ? "Derived" : "Notifier"} · {exceptionWhen(item, now)}
                    {item.userDisplayName || item.armadaUsername
                      ? ` · ${item.userDisplayName || item.armadaUsername}`
                      : ""}
                  </span>
                  {item.ackedNote ? <span className="muted">Note: {item.ackedNote}</span> : null}
                </div>
                <div className="exceptions-row-actions">
                  {uid ? (
                    <>
                      <a className="btn-ghost" href={tripsHref(search)}>
                        Trips
                      </a>
                      <a className="btn-ghost" href={fullHref(search)}>
                        Full
                      </a>
                    </>
                  ) : (
                    <span className="muted">No userId</span>
                  )}
                  {item.source === "notify" && !item.ackedAt && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === item.id}
                      onClick={() => void onAck(item.id)}
                    >
                      Ack
                    </button>
                  )}
                  {item.source === "notify" && item.ackedAt && (
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
