import { compareSnapshots, deltaTone } from "../lib/compare";
import { totalsToCompare, type FleetVehicleRow } from "../lib/fleet";
import {
  formatHours,
  formatIdr,
  formatKm,
  formatKmPerL,
  formatLiters,
  formatMeters,
  formatRpm,
  formatSpeed,
} from "../lib/format";
import { fleetHeadToHeadSheet } from "../lib/panelExcel";
import { ExportExcelButton } from "./ExportExcelButton";

function formatValue(id: string, n: number): string {
  if (id === "active" || id === "idle") return `${formatHours(n)} h`;
  if (id === "speed") return n > 0 ? `${formatSpeed(n)} km/h` : "—";
  if (id === "rpm") return n > 0 ? `${formatRpm(n)}` : "—";
  if (id === "fuel" || id === "refill" || id === "can" || id === "tank") return `${formatLiters(n)} L`;
  if (id === "kml" || id === "flatkml") return n > 0 ? `${formatKmPerL(n)} km/l` : "—";
  if (id === "cost") return formatIdr(n);
  if (id === "gain" || id === "loss") return formatMeters(n);
  if (id === "bumpy") return `${n.toFixed(1)}%`;
  return `${formatKm(n)} km`;
}

function formatDelta(pct: number | null, b: number, a: number): string {
  if (pct === null) return a === 0 && b > 0 ? "From zero" : "—";
  if (pct === 0) return "No change";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

type Props = {
  vehicles: FleetVehicleRow[];
  baselineId: number;
  compareId: number;
  onBaseline: (id: number) => void;
  onCompare: (id: number) => void;
};

export function FleetHeadToHead({ vehicles, baselineId, compareId, onBaseline, onCompare }: Props) {
  const live = vehicles.filter((v) => v.hasData);
  const baseline = live.find((v) => v.userId === baselineId) ?? live[0];
  const compare =
    live.find((v) => v.userId === compareId && v.userId !== baseline?.userId) ??
    live.find((v) => v.userId !== baseline?.userId);
  const metrics =
    baseline && compare ? compareSnapshots(totalsToCompare(baseline.totals), totalsToCompare(compare.totals)) : [];

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Head to head</h2>
          <p>Second vehicle versus the first. Idle, fuel, and cost are better when they fall; efficiency is better when it rises.</p>
        </div>
        <div className="panel-head-aside">
          <div className="compare-picks">
            <div className="field">
              <label htmlFor="fleet-a">First</label>
              <select
                id="fleet-a"
                value={baseline?.userId ?? ""}
                onChange={(e) => onBaseline(Number(e.target.value))}
              >
                {live.map((v) => (
                  <option key={v.userId} value={v.userId}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fleet-b">Second</label>
              <select
                id="fleet-b"
                value={compare?.userId ?? ""}
                onChange={(e) => onCompare(Number(e.target.value))}
              >
                {live.map((v) => (
                  <option key={v.userId} value={v.userId}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ExportExcelButton
            disabled={!baseline || !compare}
            prefix="fleet-head-to-head"
            sheetName="Head to head"
            getRows={() =>
              fleetHeadToHeadSheet(vehicles, baseline!.userId, compare!.userId)
            }
          />
        </div>
      </div>
      {metrics.length === 0 ? (
        <p className="compare-hint">Load at least two vehicles with trips in this range.</p>
      ) : (
        <div className="compare-grid">
          {metrics.map((metric) => {
            const max = Math.max(metric.a, metric.b, 0.0001);
            const tone = deltaTone(metric);
            return (
              <article key={metric.id} className="compare-card">
                <div className="compare-card-top">
                  <span className="l">{metric.label}</span>
                  <span className={`delta ${tone}`}>{formatDelta(metric.pct, metric.b, metric.a)}</span>
                </div>
                <div className="compare-values">
                  <span>{formatValue(metric.id, metric.a)}</span>
                  <span>{formatValue(metric.id, metric.b)}</span>
                </div>
                <div className="compare-bar" aria-hidden="true">
                  <span className="track">
                    <i style={{ width: `${(metric.a / max) * 100}%`, background: baseline?.color ?? "var(--gps)" }} />
                  </span>
                  <span className="track">
                    <i style={{ width: `${(metric.b / max) * 100}%`, background: compare?.color ?? "var(--ign)" }} />
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
