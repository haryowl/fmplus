import { useEffect, useRef } from "react";
import {
  buildTimelineRows,
  minToHm,
  nowJakartaMin,
  todayJakartaYmd,
  type TimelineAxis,
  type TimelineNode,
  type TimelineRow,
} from "../lib/dispatchLiveTimeline";
import type { DispatchLiveDriver } from "../lib/dispatch";

type Props = {
  drivers: DispatchLiveDriver[];
  serviceDate: string;
  focusJobId: string | null;
  focusStopId: string | null;
  onSelectStop: (jobId: string, stopId: string) => void;
  onSelectJob: (jobId: string) => void;
};

function nodeGlyph(node: TimelineNode): string {
  if (node.role === "depot") return "D";
  if (node.role === "return") return "R";
  return String(node.stopNumber);
}

function formatDelta(deltaMin: number | null): string {
  if (deltaMin == null) return "";
  if (deltaMin === 0) return "on plan";
  if (deltaMin > 0) return `+${deltaMin} min vs plan`;
  return `${deltaMin} min vs plan`;
}

export function DispatchLiveTimeline({
  drivers,
  serviceDate,
  focusJobId,
  focusStopId,
  onSelectStop,
  onSelectJob,
}: Props) {
  const showNow = serviceDate === todayJakartaYmd();
  const { axis, rows } = buildTimelineRows(drivers, {
    nowMin: showNow ? nowJakartaMin() : null,
  });
  const visible = focusJobId ? rows.filter((r) => r.jobId === focusJobId) : rows;
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusStopId || !scrollerRef.current) return;
    const el = scrollerRef.current.querySelector(`[data-stop-id="${CSS.escape(focusStopId)}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, [focusStopId, focusJobId, visible.length]);

  if (!drivers.length) {
    return (
      <section className="dispatch-live-timeline panel" aria-label="Progress timeline">
        <div className="dispatch-pane-head">
          <h2>Progress</h2>
        </div>
        <p className="dispatch-live-empty">No routes to plot for this date.</p>
      </section>
    );
  }

  return (
    <section className="dispatch-live-timeline panel" aria-label="Progress timeline">
      <div className="dispatch-pane-head">
        <h2>Progress</h2>
        <span className="dispatch-live-timeline-hint">
          {minToHm(axis.startMin)}–{minToHm(axis.endMin)} WIB · faded plan · green actual
        </span>
      </div>

      <div className="dispatch-live-gantt" ref={scrollerRef}>
        <div className="dispatch-live-gantt-hours" style={{ gridTemplateColumns: `160px 1fr` }}>
          <div className="dispatch-live-gantt-corner" aria-hidden />
          <div className="dispatch-live-gantt-scale" aria-hidden>
            {axis.ticks.map((t) => (
              <span
                key={t}
                className="dispatch-live-gantt-tick"
                style={{ left: `${((t - axis.startMin) / Math.max(1, axis.endMin - axis.startMin)) * 100}%` }}
              >
                {minToHm(t)}
              </span>
            ))}
          </div>
        </div>

        <ul className="dispatch-live-gantt-rows">
          {visible.map((row) => (
            <TimelineRowView
              key={row.jobId}
              row={row}
              axis={axis}
              focusJobId={focusJobId}
              focusStopId={focusStopId}
              onSelectJob={onSelectJob}
              onSelectStop={onSelectStop}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function TimelineRowView({
  row,
  axis,
  focusJobId,
  focusStopId,
  onSelectJob,
  onSelectStop,
}: {
  row: TimelineRow;
  axis: TimelineAxis;
  focusJobId: string | null;
  focusStopId: string | null;
  onSelectJob: (jobId: string) => void;
  onSelectStop: (jobId: string, stopId: string) => void;
}) {
  const focused = focusJobId === row.jobId;
  const span = Math.max(1, axis.endMin - axis.startMin);
  const plannedChain = row.nodes.filter((n) => n.plannedPct != null);
  const actualChain = row.nodes.filter((n) => n.actualPct != null);

  return (
    <li className={`dispatch-live-gantt-row${focused ? " is-focused" : ""}`}>
      <button
        type="button"
        className="dispatch-live-gantt-label"
        onClick={() => onSelectJob(row.jobId)}
        title={`${row.driverName} · ${row.vehicleLabel}`}
      >
        <span className="dispatch-live-avatar" aria-hidden>
          {row.driverInitials}
        </span>
        <span>
          <strong>{row.driverName}</strong>
          <em>
            {row.vehicleLabel} · {row.pctComplete}%
          </em>
        </span>
      </button>

      <div className="dispatch-live-gantt-track" role="list">
        {axis.ticks.map((t) => (
          <i
            key={t}
            className="dispatch-live-gantt-gridline"
            style={{ left: `${((t - axis.startMin) / span) * 100}%` }}
            aria-hidden
          />
        ))}

        {axis.nowPct != null ? (
          <i className="dispatch-live-gantt-now" style={{ left: `${axis.nowPct}%` }} aria-hidden />
        ) : null}

        {/* Planned path (faded) */}
        {plannedChain.map((node, idx) => {
          const next = plannedChain[idx + 1];
          if (!next || node.plannedPct == null || next.plannedPct == null) return null;
          const left = Math.min(node.plannedPct, next.plannedPct);
          const width = Math.abs(next.plannedPct - node.plannedPct);
          return (
            <span
              key={`${node.stopId}-plan-seg`}
              className="dispatch-live-gantt-seg is-planned"
              style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }}
              aria-hidden
            />
          );
        })}

        {/* Actual path (highlight) */}
        {actualChain.map((node, idx) => {
          const next = actualChain[idx + 1];
          if (!next || node.actualPct == null || next.actualPct == null) return null;
          const left = Math.min(node.actualPct, next.actualPct);
          const width = Math.abs(next.actualPct - node.actualPct);
          return (
            <span
              key={`${node.stopId}-act-seg`}
              className="dispatch-live-gantt-seg is-actual"
              style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }}
              aria-hidden
            />
          );
        })}

        {/* Pending connector when no actuals yet: use primary pct */}
        {actualChain.length < 2
          ? row.nodes.map((node, idx) => {
              const next = row.nodes[idx + 1];
              if (!next) return null;
              if (node.plannedPct != null && next.plannedPct != null) return null;
              const left = Math.min(node.pct, next.pct);
              const width = Math.abs(next.pct - node.pct);
              return (
                <span
                  key={`${node.stopId}-seg`}
                  className="dispatch-live-gantt-seg is-pending"
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }}
                  aria-hidden
                />
              );
            })
          : null}

        {row.nodes.map((node) => (
          <WindowBar key={`${node.stopId}-win`} node={node} />
        ))}

        {/* Plan↔actual delta whiskers */}
        {row.nodes.map((node) => {
          if (node.plannedPct == null || node.actualPct == null) return null;
          if (Math.abs(node.plannedPct - node.actualPct) < 0.35) return null;
          const left = Math.min(node.plannedPct, node.actualPct);
          const width = Math.abs(node.actualPct - node.plannedPct);
          return (
            <span
              key={`${node.stopId}-delta`}
              className="dispatch-live-gantt-delta"
              style={{ left: `${left}%`, width: `${width}%` }}
              aria-hidden
            />
          );
        })}

        {/* Faded planned marks (always when planned known) */}
        {row.nodes.map((node) => {
          if (node.plannedPct == null) return null;
          const selected = focusStopId === node.stopId && node.actualPct == null;
          const title = [
            `${node.label}`,
            `Plan ${node.plannedTimeLabel || minToHm(node.plannedMinute!)}`,
            node.actualTimeLabel ? `Actual ${node.actualTimeLabel}` : null,
            formatDelta(node.deltaMin) || null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={`${node.stopId}-plan`}
              type="button"
              className={`dispatch-live-gantt-node is-planned${
                node.role === "depot" || node.role === "return" ? " is-anchor" : ""
              }${selected ? " is-selected" : ""}`}
              style={{ left: `${node.plannedPct}%` }}
              title={title}
              aria-label={`Planned ${node.label} ${node.plannedTimeLabel || ""}`}
              onClick={() => onSelectStop(row.jobId, node.stopId)}
            >
              <span>{nodeGlyph(node)}</span>
            </button>
          );
        })}

        {/* Actual / primary marks — green when completed */}
        {row.nodes.map((node) => {
          const hasActual = node.actualPct != null;
          const selected = focusStopId === node.stopId;
          // If only planned (no actual), the planned mark above is enough — avoid double stack.
          if (!hasActual && node.plannedPct != null) return null;
          const left = hasActual ? node.actualPct! : node.pct;
          const title = [
            `${node.label}`,
            hasActual
              ? `Actual ${node.actualTimeLabel || node.timeLabel}`
              : node.timeLabel,
            node.plannedTimeLabel ? `Plan ${node.plannedTimeLabel}` : null,
            formatDelta(node.deltaMin) || null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={node.stopId}
              type="button"
              role="listitem"
              data-stop-id={node.stopId}
              className={`dispatch-live-gantt-node${hasActual ? " is-actual" : " is-pending"}${
                node.role === "depot" || node.role === "return" ? " is-anchor" : ""
              }${selected ? " is-selected" : ""}`}
              style={{ left: `${left}%` }}
              title={title}
              aria-label={`${node.role === "depot" ? "Depot" : node.role === "return" ? "Return" : `Stop ${node.stopNumber}`} ${node.label}, ${title}`}
              onClick={() => onSelectStop(row.jobId, node.stopId)}
            >
              <span>{nodeGlyph(node)}</span>
            </button>
          );
        })}
      </div>
    </li>
  );
}

function WindowBar({ node }: { node: TimelineNode }) {
  if (node.timeSource === "planned" || node.timeSource === "actual") return null;
  if (node.windowStartPct == null || node.windowEndPct == null) return null;
  const left = Math.min(node.windowStartPct, node.windowEndPct);
  const width = Math.abs(node.windowEndPct - node.windowStartPct);
  if (width < 0.2) return null;
  return (
    <span
      className="dispatch-live-gantt-window"
      style={{ left: `${left}%`, width: `${width}%` }}
      aria-hidden
    />
  );
}
