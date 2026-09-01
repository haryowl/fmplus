import { useMemo, useState } from "react";
import {
  RANK_COLUMNS,
  columnTones,
  sortFleetRows,
  type FleetVehicleRow,
  type RankColumnId,
} from "../lib/fleet";
import {
  formatHours,
  formatIdr,
  formatKm,
  formatKmPerL,
  formatPct,
} from "../lib/format";
import { fullHref } from "../lib/routing";

function openVehicleHref(userId: number): string {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  params.set("userId", String(userId));
  params.delete("userIds");
  const q = params.toString();
  return fullHref(q ? `?${q}` : "");
}

type Props = {
  vehicles: FleetVehicleRow[];
  dense?: boolean;
};

function formatCell(id: RankColumnId, n: number): string {
  if (id === "hours") return formatHours(n);
  if (id === "idleShare" || id === "bumpy") return formatPct(n);
  if (id === "kmPerL") return n > 0 ? formatKmPerL(n) : "—";
  if (id === "cost") return n > 0 ? formatIdr(n) : "—";
  if (id === "safety") return n > 0 ? n.toFixed(0) : "—";
  if (id === "events") return n.toFixed(2);
  return formatKm(n);
}

export function FleetRankTable({ vehicles, dense }: Props) {
  const [sortId, setSortId] = useState<RankColumnId>("gps");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => sortFleetRows(vehicles, sortId, dir), [vehicles, sortId, dir]);

  const tones = useMemo(() => {
    const map = new Map<RankColumnId, Array<"best" | "worst" | "">>();
    for (const col of RANK_COLUMNS) {
      map.set(
        col.id,
        columnTones(
          sorted.map((row) => col.value(row)),
          col.prefer,
        ),
      );
    }
    return map;
  }, [sorted]);

  function toggle(id: RankColumnId) {
    if (id === sortId) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortId(id);
      const col = RANK_COLUMNS.find((c) => c.id === id);
      setDir(col?.prefer === "lower" ? "asc" : "desc");
    }
  }

  if (vehicles.length === 0) {
    return <p className="compare-hint">Select vehicles and load metrics to rank them.</p>;
  }

  return (
    <div className={dense ? "table-wrap rank-wrap dense" : "table-wrap rank-wrap"}>
      <table className="metrics rank-table">
        <thead>
          <tr>
            <th>Vehicle</th>
            {RANK_COLUMNS.map((col) => (
              <th key={col.id} className="num">
                <button type="button" className="sort-btn" onClick={() => toggle(col.id)}>
                  {col.label}
                  {sortId === col.id ? (dir === "desc" ? " ↓" : " ↑") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={row.userId}>
              <td>
                <span className="rank-name">
                  <i className="swatch" style={{ background: row.color }} />
                  {row.label}
                </span>
                {!dense && (
                  <a className="rank-open" href={openVehicleHref(row.userId)}>
                    Open
                  </a>
                )}
              </td>
              {RANK_COLUMNS.map((col) => {
                const tone = tones.get(col.id)?.[index] ?? "";
                return (
                  <td key={col.id} className={`num ${tone ? `tone-${tone}` : ""}`}>
                    {row.hasData ? formatCell(col.id, col.value(row)) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
