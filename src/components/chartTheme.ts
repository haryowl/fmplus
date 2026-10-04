import { useEffect, useMemo, useState } from "react";

export const chartFonts = {
  ui: "Plus Jakarta Sans",
  mono: "IBM Plex Mono",
};

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function useChartTheme() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onTheme = () => setRevision((n) => n + 1);
    window.addEventListener("fmplus:theme", onTheme);
    return () => window.removeEventListener("fmplus:theme", onTheme);
  }, []);

  return useMemo(() => {
    const gps = cssVar("--gps", "#0b6b62");
    const ign = cssVar("--ign", "#3b4cb3");
    const odo = cssVar("--odo", "#9a3b12");
    const hrs = cssVar("--hrs", "#171614");
    const idle = cssVar("--idle", "#c47d3a");
    const refill = cssVar("--refill", "#c45c16");
    const danger = cssVar("--danger", "#9f2a2a");
    const cost = cssVar("--cost", "#c9a882");
    const costLine = cssVar("--cost-line", "#8a6a4a");
    const price = cssVar("--price", "#8a9a7a");
    const priceLine = cssVar("--price-line", "#5a7a6a");
    const surface = cssVar("--surface", "#fbf9f4");
    const ink = cssVar("--ink", "#171614");
    const inkSoft = cssVar("--ink-soft", "#5e584f");
    const inkFaint = cssVar("--ink-faint", "#8a8378");
    const upcoming = cssVar("--health-upcoming", "#b7a56a");
    const due = cssVar("--health-due", "#c49a5a");
    const overdue = cssVar("--health-overdue", "#c97a7a");
    const ok = cssVar("--health-ok", "#8a9a7a");
    const none = cssVar("--health-none", "#c9bfae");
    const completed = cssVar("--health-completed", "#2f6b45");
    const opened = cssVar("--health-opened", "#6b6458");
    const deep = cssVar("--health-deep", "#a06060");
    const jobPending = cssVar("--job-pending", "#c49a5a");
    const jobActive = cssVar("--job-active", "#0b6b62");
    const jobDone = cssVar("--job-done", "#5a7a72");
    return {
      gps,
      ign,
      odo,
      hrs,
      idle,
      refill,
      danger,
      cost,
      costLine,
      price,
      priceLine,
      surface,
      ink,
      inkSoft,
      inkFaint,
      upcoming,
      due,
      overdue,
      ok,
      none,
      completed,
      opened,
      aging: [ok, upcoming, due, overdue, deep],
      jobs: [jobPending, jobActive, jobDone],
      gpsSoft: withAlpha(gps, 0.08),
      odoSoft: withAlpha(odo, 0.07),
      gpsFill: withAlpha(gps, 0.82),
      ignFill: withAlpha(ign, 0.78),
      odoFill: withAlpha(odo, 0.78),
      hrsFill: withAlpha(hrs, 0.06),
      idleFill: withAlpha(idle, 0.88),
      dangerFill: withAlpha(danger, 0.88),
      refillFill: withAlpha(refill, 0.82),
      costFill: withAlpha(costLine, 0.12),
      priceFill: withAlpha(priceLine, 0.1),
      completedFill: withAlpha(completed, 0.12),
      openedFill: withAlpha(opened, 0.08),
      grid: withAlpha(ink, 0.07),
      tooltip: {
        ...baseTooltip,
        backgroundColor: cssVar("--nav", "#171614"),
        titleColor: cssVar("--nav-text", "#f4efe6"),
        bodyColor: cssVar("--nav-muted", "#d9d2c6"),
      },
      ticks: { ...axisTicks, color: inkFaint },
      title: { ...axisTitle, color: inkFaint },
    };
  }, [revision]);
}

/** Shared tooltip chrome — plain object so it spreads into bar/line/doughnut options safely. */
export const baseTooltip = {
  backgroundColor: "#171614",
  titleColor: "#f4efe6",
  bodyColor: "#d9d2c6",
  titleFont: { family: chartFonts.ui, size: 12, weight: 600 as const },
  bodyFont: { family: chartFonts.mono, size: 11 },
  padding: 12,
  cornerRadius: 8,
  boxPadding: 4,
};

export const axisTitle = {
  color: "#8a8378",
  font: { family: chartFonts.ui, size: 11, weight: 500 as const },
};

export const axisTicks = {
  color: "#8a8378",
  font: { family: chartFonts.mono, size: 10 },
};
