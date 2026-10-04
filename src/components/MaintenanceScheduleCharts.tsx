import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { chartFonts, useChartTheme } from "./chartTheme";
import type { ScheduleSummary } from "../lib/maintenance";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip);

export type ScheduleHealthBars = {
  labels: string[];
  values: number[];
  keys: string[];
};

export type ScheduleTimeline = {
  days: number;
  labels: string[];
  completed: number[];
  opened: number[];
};

type Props = {
  summary: ScheduleSummary | null;
  healthBars?: ScheduleHealthBars | null;
  timeline?: ScheduleTimeline | null;
  onSelectHealth?: (key: "upcoming" | "due" | "overdue" | "") => void;
};

export function MaintenanceScheduleCharts({ summary, healthBars, timeline, onSelectHealth }: Props) {
  const theme = useChartTheme();
  const healthColors: Record<string, string> = {
    upcoming: theme.upcoming,
    due: theme.due,
    overdue: theme.overdue,
    ok: theme.ok,
    none: theme.none,
  };
  const barLabels = healthBars?.labels || ["Upcoming", "Due", "Overdue", "On track", "Unscheduled"];
  const barKeys = healthBars?.keys || ["upcoming", "due", "overdue", "ok", "none"];
  const barValues =
    healthBars?.values ||
    (summary
      ? [summary.upcoming, summary.due, summary.overdue, summary.ok || 0, summary.none || 0]
      : [0, 0, 0, 0, 0]);

  const barData: ChartData<"bar"> = {
    labels: barLabels,
    datasets: [
      {
        label: "Open jobs",
        data: barValues,
        backgroundColor: barKeys.map((k) => healthColors[k] || theme.none),
        borderRadius: 3,
        maxBarThickness: 36,
      },
    ],
  };

  const barOptions: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        ...theme.tooltip,
        callbacks: {
          label(item) {
            return ` ${Number(item.parsed.y ?? 0)} jobs`;
          },
        },
      },
    },
    onClick(_evt, elements) {
      if (!onSelectHealth || !elements.length) return;
      const idx = elements[0].index;
      const key = barKeys[idx];
      if (key === "upcoming" || key === "due" || key === "overdue") onSelectHealth(key);
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: theme.inkSoft, font: { family: chartFonts.ui, size: 11 }, maxRotation: 0 },
      },
      y: {
        beginAtZero: true,
        ticks: {
          ...theme.ticks,
          precision: 0,
          stepSize: 1,
        },
        border: { display: false },
        grid: { color: theme.grid },
      },
    },
  };

  const lineData: ChartData<"line"> = {
    labels: timeline?.labels || [],
    datasets: [
      {
        label: "Completed",
        data: timeline?.completed || [],
        borderColor: theme.completed,
        backgroundColor: theme.completedFill,
        pointBackgroundColor: theme.surface,
        pointBorderColor: theme.completed,
        pointRadius: 3,
        borderWidth: 2,
        tension: 0.28,
        fill: true,
      },
      {
        label: "Opened",
        data: timeline?.opened || [],
        borderColor: theme.opened,
        backgroundColor: theme.openedFill,
        pointBackgroundColor: theme.surface,
        pointBorderColor: theme.opened,
        pointRadius: 3,
        borderWidth: 2,
        tension: 0.28,
        fill: false,
      },
    ],
  };

  const lineOptions: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        display: true,
        position: "top",
        align: "end",
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          color: theme.inkSoft,
          font: { family: chartFonts.ui, size: 11 },
        },
      },
      tooltip: {
        ...theme.tooltip,
        callbacks: {
          label(item) {
            return ` ${item.dataset.label}: ${Number(item.parsed.y ?? 0)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: theme.inkSoft, font: { family: chartFonts.mono, size: 10 }, maxRotation: 0 },
      },
      y: {
        beginAtZero: true,
        ticks: { ...theme.ticks, precision: 0, stepSize: 1 },
        border: { display: false },
        grid: { color: theme.grid },
      },
    },
  };

  return (
    <div className="maintenance-schedule-charts">
      <article className="maintenance-chart-panel">
        <header>
          <h3>Schedule mix</h3>
          <p className="muted">Open jobs by health (click a bar to filter)</p>
        </header>
        <div className="chart-wrap chart-wrap-sm">
          <Bar data={barData} options={barOptions} />
        </div>
      </article>
      <article className="maintenance-chart-panel">
        <header>
          <h3>Last {timeline?.days ?? 14} days</h3>
          <p className="muted">Opened vs completed over time</p>
        </header>
        <div className="chart-wrap chart-wrap-sm">
          <Line data={lineData} options={lineOptions} />
        </div>
      </article>
    </div>
  );
}
