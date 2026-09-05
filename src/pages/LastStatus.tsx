import { useEffect, useState } from "react";
import { fetchGroups, fetchUsersForGroup, groupOptionLabel } from "../lib/api";
import { TIMEZONES } from "../lib/config";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import { writeLocationSearch } from "../lib/routing";
import type { Group, User } from "../lib/types";
import { BrandMark } from "../components/BrandMark";
import { ExportPdfButton } from "../components/ExportPdfButton";
import { LastStatusPanel } from "../components/LastStatusPanel";
import { ViewNav } from "../components/ViewNav";

export default function LastStatus() {
  const { query, ready, error: tenantError, allowedUserIds, allowedGroupIds, allowsUser, allowsGroup } =
    useEmbedTenant();
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groupId, setGroupId] = useState(query.groupId);
  const [timezone, setTimezone] = useState(query.tz);
  const [bootError, setBootError] = useState("");

  const selectedGroup = groups.find((g) => String(g.id) === groupId);

  useEffect(() => {
    writeLocationSearch({
      groupId: groupId || null,
      tz: timezone || null,
    });
  }, [groupId, timezone]);

  useEffect(() => {
    const previous = document.title;
    document.title = "Last status · FM Plus";
    return () => {
      document.title = previous;
    };
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
        if (allowedGroupIds.length === 1) {
          setGroupId(String(allowedGroupIds[0]));
        }
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

  return (
    <div className="app status-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Last status</h1>
            <p>Latest position for every device · snapshot</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="status" />
          <ExportPdfButton />
          <div className="vehicle-chip">
            {groupId && users.length ? `${users.length} devices` : "All devices"}
            {selectedGroup ? ` · ${selectedGroup.name}` : ""}
          </div>
        </div>
      </header>

      <p className="print-meta">
        {groupId && users.length ? `${users.length} devices` : "All devices"}
        {selectedGroup ? ` · ${selectedGroup.name}` : ""}
        {timezone ? ` · ${timezone}` : ""}
      </p>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="s-group">Group</label>
            <select
              id="s-group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
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
            <label htmlFor="s-tz">Timezone</label>
            <select
              id="s-tz"
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
        </section>

        {bootError && <div className="banner error">{bootError}</div>}

        <LastStatusPanel
          groupId={groupId}
          timezone={timezone}
          userIds={groupId && users.length ? users.map((u) => u.id) : undefined}
          fill
        />
      </main>
    </div>
  );
}
