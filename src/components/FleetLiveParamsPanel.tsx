import { useEffect, useMemo, useState } from "react";
import {
  fetchDeviceParamValues,
  fetchFixParamValues,
  type TelemetryParamRow,
} from "../lib/fleetTelemetryParams";
import { IcoCopy, IcoSearch } from "./fleetLiveIcons";
import { TelemetryParamTable } from "./TelemetryParamTable";

type Props = (
  | {
      mode: "live";
      deviceId: string | null | undefined;
      pollMs?: number;
    }
  | {
      mode: "fix";
      deviceId: string | null | undefined;
      recordedAt: string | null | undefined;
    }
) & {
  variant?: "default" | "inspector";
  protocol?: string;
};

function categoryLabel(cat: string): string {
  const c = (cat || "").trim().toLowerCase();
  if (!c) return "Other";
  if (c === "mapped_extra") return "Extra";
  return c.replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function FleetLiveParamsPanel(props: Props) {
  const [rows, setRows] = useState<TelemetryParamRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [includeRaw, setIncludeRaw] = useState(false);
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("all");
  const [copied, setCopied] = useState(false);
  const deviceId = props.deviceId || "";
  const recordedAt = props.mode === "fix" ? props.recordedAt || "" : "";
  const pollMs = props.mode === "live" ? props.pollMs ?? 4000 : 0;
  const filterNorm = filter.trim().toLowerCase();
  const inspector = props.variant === "inspector";
  const protocol = (props.protocol || rows[0]?.protocol || "").trim();

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = (r.category || "other").toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, count]) => ({ id, count, label: categoryLabel(id) }));
  }, [rows]);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (category !== "all" && (r.category || "other").toLowerCase() !== category) {
        return false;
      }
      if (!filterNorm) return true;
      const hay = `${r.paramId} ${r.paramLabel} ${r.category} ${r.unit || ""} ${r.source} ${r.value ?? ""}`.toLowerCase();
      return hay.includes(filterNorm);
    });
  }, [rows, category, filterNorm]);

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

  useEffect(() => {
    if (category === "all") return;
    if (!categories.some((c) => c.id === category)) setCategory("all");
  }, [categories, category]);

  async function copyVisible() {
    const lines = visibleRows.map((r) => {
      const unit = (r.unit || "").trim();
      const val = r.value == null ? "" : String(r.value);
      const withUnit =
        unit && val && !val.toLowerCase().endsWith(unit.toLowerCase()) ? `${val} ${unit}` : val;
      return `${r.paramLabel || r.paramId}\t${withUnit}`;
    });
    const text = ["Label\tValue", ...lines].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  if (!deviceId) {
    return <p className="muted fleet-params-empty">Select a device to see mapper parameters.</p>;
  }

  const countLabel = loading
    ? "Updating…"
    : filterNorm || category !== "all"
      ? `${visibleRows.length}/${rows.length} params`
      : `${rows.length} params`;
  const prettyProto = protocol
    ? protocol.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "";

  return (
    <div className={`fleet-params-panel${inspector ? " is-inspector" : ""}`}>
      <div className="fleet-params-tools">
        <label className="fleet-params-filter">
          <IcoSearch />
          <span className="sr-only">Filter parameters</span>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter params"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className="fleet-params-copy"
          onClick={() => void copyVisible()}
          disabled={!visibleRows.length}
          title="Copy Label and Value as tab-separated text"
        >
          <IcoCopy />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {categories.length > 1 ? (
        <div className="fleet-params-cats" role="tablist" aria-label="Param categories">
          <button
            type="button"
            role="tab"
            className={category === "all" ? "is-active" : ""}
            aria-selected={category === "all"}
            onClick={() => setCategory("all")}
          >
            All <em>{rows.length}</em>
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              className={category === c.id ? "is-active" : ""}
              aria-selected={category === c.id}
              onClick={() => setCategory(c.id)}
            >
              {c.label} <em>{c.count}</em>
            </button>
          ))}
        </div>
      ) : null}
      <label className="fleet-rules-check fleet-params-raw">
        <input
          type="checkbox"
          checked={includeRaw}
          onChange={(e) => setIncludeRaw(e.target.checked)}
        />
        Include raw vendor keys
      </label>
      {error ? <div className="banner error fleet-cc-banner">{error}</div> : null}
      <TelemetryParamTable
        rows={visibleRows}
        loading={loading}
        compact
        pills={inspector}
        emptyText={
          (filterNorm || category !== "all") && rows.length
            ? "No parameters match this filter."
            : undefined
        }
      />
      <footer className="fleet-params-foot">
        <span>
          {props.mode === "live" ? "live" : "fix"} · {countLabel}
        </span>
        {prettyProto ? <span>{prettyProto}</span> : null}
      </footer>
    </div>
  );
}
