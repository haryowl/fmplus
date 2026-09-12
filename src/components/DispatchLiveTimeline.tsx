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

function statusTone(status: string): string {
  if (
    status === "delivered" ||
    status === "in_transit" ||
    status === "delayed" ||
    status === "skipped" ||
    status === "pending"
  ) {
    return status;
  }
  return "pending";
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
          {minToHm(axis.startMin)}–{minToHm(axis.endMin)} WIB · node = stop time
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

        {row.nodes.map((node, idx) => {
          const next = row.nodes[idx + 1];
          if (!next) return null;
          const left = Math.min(node.pct, next.pct);
          const width = Math.abs(next.pct - node.pct);
          return (
            <span
              key={`${node.stopId}-seg`}
              className={`dispatch-live-gantt-seg tone-${statusTone(node.status)}`}
              style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }}
              aria-hidden
            />
          );
        })}

        {row.nodes.map((node) => (
          <WindowBar key={`${node.stopId}-win`} node={node} />
        ))}

        {row.nodes.map((node) => {
          const selected = focusStopId === node.stopId;
          const tone = statusTone(node.status);
          return (
            <button
              key={node.stopId}
              type="button"
              role="listitem"
              data-stop-id={node.stopId}
              className={`dispatch-live-gantt-node tone-${tone}${selected ? " is-selected" : ""}`}
              style={{ left: `${node.pct}%` }}
              title={`${node.label} · ${node.timeLabel} (${node.timeSource})`}
              aria-label={`Stop ${node.stopNumber} ${node.label}, ${node.status}, ${node.timeLabel}`}
              onClick={() => onSelectStop(row.jobId, node.stopId)}
            >
              <span>{node.stopNumber}</span>
            </button>
          );
        })}
      </div>
    </li>
  );
}

function WindowBar({ node }: { node: TimelineNode }) {
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
