import type { TelemetryParamRow } from "../lib/fleetTelemetryParams";

type Props = {
  rows: TelemetryParamRow[];
  loading?: boolean;
  emptyText?: string;
  compact?: boolean;
  showDevice?: boolean;
  pills?: boolean;
};

function isAlarmParam(row: TelemetryParamRow): boolean {
  const key = `${row.paramId} ${row.paramLabel}`.toLowerCase();
  return /sos|crash|alarm|panic|alert|jamming|unplug|towing/.test(key);
}

function valueTone(row: TelemetryParamRow): "alert" | "on" | "off" | "" {
  const v = row.value;
  const truth =
    v === true || v === 1 || String(v).toLowerCase() === "true" || String(v).toLowerCase() === "on";
  const falsy =
    v === false || v === 0 || String(v).toLowerCase() === "false" || String(v).toLowerCase() === "off";
  if (truth) return isAlarmParam(row) ? "alert" : "on";
  if (falsy) return "off";
  return "";
}

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
  pills = false,
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
                {pills && valueTone(row) ? (
                  <strong className={`fleet-params-pill is-${valueTone(row)}`}>
                    {formatCellValue(row)}
                  </strong>
                ) : (
                  <strong>{formatCellValue(row)}</strong>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
