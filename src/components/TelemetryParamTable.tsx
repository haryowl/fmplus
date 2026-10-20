import type { TelemetryParamRow } from "../lib/fleetTelemetryParams";

type Props = {
  rows: TelemetryParamRow[];
  loading?: boolean;
  emptyText?: string;
  compact?: boolean;
  showDevice?: boolean;
};

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
            <th>Param</th>
            <th>Label</th>
            <th>Value</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.deviceId}-${row.source}-${row.paramId}-${idx}`}>
              {showDevice ? <td>{row.label || row.imei || "—"}</td> : null}
              <td>
                <code>{row.paramId}</code>
              </td>
              <td>{row.paramLabel}</td>
              <td>
                <strong>{row.value == null ? "—" : String(row.value)}</strong>
              </td>
              <td>
                <em className={`fleet-params-src is-${row.source}`}>{row.source}</em>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
