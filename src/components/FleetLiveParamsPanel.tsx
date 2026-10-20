import { useEffect, useState } from "react";
import {
  fetchDeviceParamValues,
  fetchFixParamValues,
  type TelemetryParamRow,
} from "../lib/fleetTelemetryParams";
import { TelemetryParamTable } from "./TelemetryParamTable";

type Props =
  | {
      mode: "live";
      deviceId: string | null | undefined;
      pollMs?: number;
    }
  | {
      mode: "fix";
      deviceId: string | null | undefined;
      recordedAt: string | null | undefined;
    };

export function FleetLiveParamsPanel(props: Props) {
  const [rows, setRows] = useState<TelemetryParamRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [includeRaw, setIncludeRaw] = useState(false);
  const deviceId = props.deviceId || "";
  const recordedAt = props.mode === "fix" ? props.recordedAt || "" : "";
  const pollMs = props.mode === "live" ? props.pollMs ?? 4000 : 0;

  useEffect(() => {
    if (!deviceId) {
      setRows([]);
      setError("");
      return;
    }
    if (props.mode === "fix" && !recordedAt) {
      setRows([]);
      return;
    }
    const ac = new AbortController();
    const load = () => {
      setLoading(true);
      setError("");
      const req =
        props.mode === "live"
          ? fetchDeviceParamValues(deviceId, { raw: includeRaw }, ac.signal).then((list) => ({
              rows: list,
            }))
          : fetchFixParamValues(
              { deviceId, recordedAt, raw: includeRaw },
              ac.signal,
            );
      void req
        .then((data) => {
          if (!ac.signal.aborted) setRows(data.rows);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") {
            setRows([]);
            setError(err.message || "Failed to load parameters");
          }
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    };
    load();
    if (props.mode !== "live" || pollMs <= 0) return () => ac.abort();
    const id = window.setInterval(load, pollMs);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, [deviceId, recordedAt, includeRaw, props.mode, pollMs]);

  if (!deviceId) {
    return <p className="muted fleet-params-empty">Select a device to see mapper parameters.</p>;
  }

  return (
    <div className="fleet-params-panel">
      <div className="fleet-params-toolbar">
        <label className="fleet-rules-check">
          <input
            type="checkbox"
            checked={includeRaw}
            onChange={(e) => setIncludeRaw(e.target.checked)}
          />
          Include raw vendor keys
        </label>
        <span className="muted">
          {loading ? "Updating…" : `${rows.length} params`}
          {props.mode === "fix" && recordedAt
            ? ` · ${new Date(recordedAt).toLocaleString()}`
            : ""}
        </span>
      </div>
      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}
      <TelemetryParamTable rows={rows} loading={loading} compact />
    </div>
  );
}
