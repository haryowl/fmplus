import { useEffect, useState } from "react";
import { fetchGroups, fetchUsersForGroup, groupOptionLabel } from "../lib/api";
import { TIMEZONES } from "../lib/config";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import { writeLocationSearch } from "../lib/routing";
import type { Group, User } from "../lib/types";
import {
  fetchTrackerDeviceGroups,
  type TrackerDeviceGroup,
} from "../lib/trackerDevices";
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
  const [deviceGroups, setDeviceGroups] = useState<TrackerDeviceGroup[]>([]);
  const [deviceGroupId, setDeviceGroupId] = useState(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    return params.get("deviceGroupId") || "";
  });
  const [timezone, setTimezone] = useState(query.tz);
  const [bootError, setBootError] = useState("");

  const selectedGroup = groups.find((g) => String(g.id) === groupId);
  const selectedDeviceGroup = deviceGroups.find((g) => g.id === deviceGroupId);

  useEffect(() => {
    writeLocationSearch({
      groupId: deviceGroupId ? null : groupId || null,
      deviceGroupId: deviceGroupId || null,
      tz: timezone || null,
    });
  }, [groupId, deviceGroupId, timezone]);

  useEffect(() => {
    const previous = document.title;
    document.title = "Last status · ARMADA M.1";
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
    fetchTrackerDeviceGroups(ac.signal)
      .then((list) => setDeviceGroups(list))
      .catch(() => setDeviceGroups([]));
    return () => ac.abort();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    fetchGroups(ac.signal)
      .then((list) => {
        const next = allowedGroupIds.length ? list.filter((g) => allowsGroup(g.id)) : list;
        setGroups(next);
        setBootError("");
        if (!groupId && !deviceGroupId && next.length === 1) setGroupId(String(next[0].id));
        if (allowedGroupIds.length === 1) {
          setGroupId(String(allowedGroupIds[0]));
        }
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setGroups([]);
      });
    return () => ac.abort();
  }, [ready]);

  useEffect(() => {
    if (!selectedGroup || deviceGroupId) {
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
  }, [selectedGroup?.id, deviceGroupId]);

  const chipLabel = deviceGroupId
    ? selectedDeviceGroup
      ? `Device group · ${selectedDeviceGroup.name}`
      : "Device group"
    : groupId && users.length
      ? `${users.length} devices`
      : "All devices";

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
            {chipLabel}
            {!deviceGroupId && selectedGroup ? ` · ${selectedGroup.name}` : ""}
          </div>
        </div>
      </header>

      <p className="print-meta">
        {chipLabel}
        {!deviceGroupId && selectedGroup ? ` · ${selectedGroup.name}` : ""}
        {timezone ? ` · ${timezone}` : ""}
      </p>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="s-device-group">Device group</label>
            <select
              id="s-device-group"
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
                  {g.memberCount != null ? ` (${g.memberCount})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="s-group">Armada group</label>
            <select
              id="s-group"
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
          deviceGroupId={deviceGroupId || undefined}
          timezone={timezone}
          userIds={
            !deviceGroupId && groupId && users.length ? users.map((u) => u.id) : undefined
          }
          fill
        />
      </main>
    </div>
  );
}
