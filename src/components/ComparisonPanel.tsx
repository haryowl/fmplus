import { comparePeriods, deltaTone } from "../lib/compare";
import { formatHours, formatIdr, formatKm, formatKmPerL, formatLiters, formatMeters, formatRpm, formatSpeed } from "../lib/format";
import type { PeriodMetrics } from "../lib/types";

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
  rows: PeriodMetrics[];
  baselineKey: string;
  compareKey: string;
  onBaseline: (key: string) => void;
  onCompare: (key: string) => void;
};

export function ComparisonPanel({ rows, baselineKey, compareKey, onBaseline, onCompare }: Props) {
  const baseline = rows.find((row) => row.key === baselineKey);
  const compare = rows.find((row) => row.key === compareKey);
  const metrics = baseline && compare ? comparePeriods(baseline, compare) : [];

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Period comparison</h2>
          <p>
            Second period versus the first. Idle, fuel, and cost are better when they fall; efficiency
            is better when it rises.
          </p>
        </div>
        <div className="compare-picks">
          <div className="field">
            <label htmlFor="c1">First</label>
            <select id="c1" value={baselineKey} onChange={(e) => onBaseline(e.target.value)}>
              {rows.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="c2">Second</label>
            <select id="c2" value={compareKey} onChange={(e) => onCompare(e.target.value)}>
              {rows.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {metrics.length === 0 ? (
        <p className="compare-hint">Load a range with at least one period to compare.</p>
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
                    <i style={{ width: `${(metric.a / max) * 100}%`, background: "var(--gps)" }} />
                  </span>
                  <span className="track">
                    <i style={{ width: `${(metric.b / max) * 100}%`, background: "var(--ign)" }} />
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
