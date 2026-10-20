import type { TelemetryParamRow } from "../lib/fleetTelemetryParams";

type Props = {
  rows: TelemetryParamRow[];
  loading?: boolean;
  emptyText?: string;
  compact?: boolean;
  showDevice?: boolean;
};

function formatCellValue(row: TelemetryParamRow): string {
  if (row.value == null) return "—";
  const text = String(row.value);
  const unit = (row.unit || "").trim();
  if (!unit) return text;
  // Avoid duplicating units already baked into the label/value.
  if (text.toLowerCase().endsWith(unit.toLowerCase())) return text;
  return `${text} ${unit}`;
}

export function TelemetryParamTable({
  rows,
  loading = false,
  emptyText = "No mapper parameters on this uplink.",
  compact = false,
  showDevice = false,
}: Props) {
  if (loading && rows.length === 0) {
    return <p className="muted fleet-params-empty">Loading parameters…</p>;
  }
  if (!rows.length) {
    return <p className="muted fleet-params-empty">{emptyText}</p>;
  }

  return (
    <div className={`fleet-params-wrap${compact ? " is-compact" : ""}`}>
      <table className="fleet-params-table">
        <thead>
          <tr>
            {showDevice ? <th>Device</th> : null}
            <th>Label</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.deviceId}-${row.source}-${row.paramId}-${idx}`}>
              {showDevice ? <td>{row.label || row.imei || "—"}</td> : null}
              <td title={row.paramId}>{row.paramLabel || row.paramId}</td>
              <td>
                <strong>{formatCellValue(row)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
