import { useEffect, useMemo, useState } from "react";
import { fetchUsersStatus } from "../lib/api";
import { formatKm, formatSpeed } from "../lib/format";
import {
  ageLabel,
  ageTone,
  downloadStatusExcel,
  filterStatusRows,
  formatStatusTime,
  mapsUrl,
  sortStatusRows,
  type LastStatusRow,
  type LastStatusSortId,
} from "../lib/lastStatus";
import { fullHref } from "../lib/routing";

type Props = {
  groupId: string;
  timezone: string;
  userIds?: number[];
  dense?: boolean;
  fill?: boolean;
};

function vehicleHref(userId: number): string {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  params.set("userId", String(userId));
  params.delete("userIds");
  const q = params.toString();
  return fullHref(q ? `?${q}` : "");
}

export function LastStatusPanel({ groupId, timezone, userIds, dense, fill }: Props) {
  const [rows, setRows] = useState<LastStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortId, setSortId] = useState<LastStatusSortId>("lastMs");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    const gid = Number(groupId);
    void fetchUsersStatus({
      groupId: Number.isFinite(gid) && gid > 0 ? gid : undefined,
      signal: ac.signal,
    })
      .then((next) => {
        setRows(next);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message || "Last status unavailable");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [groupId, reload]);

  const scoped = useMemo(() => filterStatusRows(rows, userIds), [rows, userIds]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? scoped.filter(
          (row) =>
            row.name.toLowerCase().includes(q) ||
            row.username.toLowerCase().includes(q) ||
            String(row.id).includes(q),
        )
      : scoped;
    return sortStatusRows(filtered, sortId, dir);
  }, [scoped, query, sortId, dir]);

  function toggle(id: LastStatusSortId) {
    if (sortId === id) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortId(id);
      setDir(id === "name" ? "asc" : "desc");
    }
  }

  function sortMark(id: LastStatusSortId): string {
    if (sortId !== id) return "";
    return dir === "asc" ? " ↑" : " ↓";
  }

  return (
    <section
      className={`panel last-status-panel${dense ? " dense" : ""}${fill ? " fill" : ""}`}
    >
      <div className="panel-head">
        <div>
          <h2>Last status</h2>
          <p>
            {loading
              ? "Loading latest position for every device…"
              : `${visible.length} device${visible.length === 1 ? "" : "s"}`}
            {groupId ? " in this group" : " in this application"}
            {" · snapshot, not history"}
          </p>
        </div>
        <div className="last-status-actions no-print">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or id"
            aria-label="Search devices"
          />
          <button className="btn btn-secondary" type="button" onClick={() => setReload((n) => n + 1)} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={visible.length === 0}
            onClick={() => downloadStatusExcel(visible, timezone)}
          >
            Export Excel
          </button>
        </div>
      </div>
      {error && !loading && <div className="banner error">{error}</div>}
      {!error && !loading && visible.length === 0 ? (
        <p className="compare-hint">
          {scoped.length === 0
            ? groupId
              ? "No last status for this group yet."
              : "No devices returned last status."
            : "No devices match that search."}
        </p>
      ) : (
        <div className="table-wrap last-status-wrap">
          <table className="metrics last-status-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="sort-btn" onClick={() => toggle("name")}>
                    Vehicle{sortMark("name")}
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-btn" onClick={() => toggle("lastMs")}>
                    Last seen{sortMark("lastMs")}
                  </button>
                </th>
                <th>Age</th>
                <th>
                  <button type="button" className="sort-btn" onClick={() => toggle("ignition")}>
                    Ign.{sortMark("ignition")}
                  </button>
                </th>
                <th className="num">
                  <button type="button" className="sort-btn" onClick={() => toggle("speedKmh")}>
                    Speed{sortMark("speedKmh")}
                  </button>
                </th>
                <th className="num">
                  <button type="button" className="sort-btn" onClick={() => toggle("fuelLevel")}>
                    Fuel{sortMark("fuelLevel")}
                  </button>
                </th>
                <th className="num">
                  <button type="button" className="sort-btn" onClick={() => toggle("odometerKm")}>
                    Odo{sortMark("odometerKm")}
                  </button>
                </th>
                <th>Position</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const tone = ageTone(row.lastMs, now);
                const hasPos = row.lat !== null && row.lon !== null;
                return (
                  <tr key={row.id}>
                    <td>
                      <a className="status-vehicle" href={vehicleHref(row.id)}>
                        {row.name}
                      </a>
                      <div className="status-id">{row.id}</div>
                    </td>
                    <td className="num">{row.utc ? formatStatusTime(row.utc, timezone) : "—"}</td>
                    <td>
                      <span className={tone ? `status-age ${tone}` : "status-age"}>{ageLabel(row.lastMs, now)}</span>
                    </td>
                    <td>
                      {row.ignition === null ? (
                        "—"
                      ) : (
                        <span className={row.ignition ? "status-ign on" : "status-ign off"}>
                          {row.ignition ? "On" : "Off"}
                        </span>
                      )}
                    </td>
                    <td className="num">{row.speedKmh === null ? "—" : `${formatSpeed(row.speedKmh)} km/h`}</td>
                    <td className="num">{row.fuelLevel === null ? "—" : formatSpeed(row.fuelLevel)}</td>
                    <td className="num">{row.odometerKm === null ? "—" : formatKm(row.odometerKm)}</td>
                    <td>
                      {hasPos ? (
                        <a
                          href={mapsUrl(row.lat as number, row.lon as number)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {(row.lat as number).toFixed(5)}, {(row.lon as number).toFixed(5)}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
