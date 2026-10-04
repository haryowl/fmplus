import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { BehaviorPeriod } from "../lib/behavior";
import { axisTitle, chartFonts, useChartTheme } from "./chartTheme";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend);

type Props = {
  rows: BehaviorPeriod[];
};

export function BehaviorTrend({ rows }: Props) {
  const theme = useChartTheme();
  const data: ChartData<"line"> = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "Harsh braking",
        data: rows.map((row) => row.harshBraking),
        borderColor: theme.gps,
        backgroundColor: theme.gpsSoft,
        pointBackgroundColor: theme.surface,
        pointBorderColor: theme.gps,
        tension: 0.28,
        borderWidth: 2,
        pointRadius: 3,
        fill: false,
      },
      {
        label: "Harsh acceleration",
        data: rows.map((row) => row.harshAcceleration),
        borderColor: theme.ign,
        backgroundColor: "transparent",
        pointBackgroundColor: theme.surface,
        pointBorderColor: theme.ign,
        tension: 0.28,
        borderWidth: 2,
        pointRadius: 3,
      },
      {
        label: "Harsh cornering",
        data: rows.map((row) => row.harshCornering),
        borderColor: theme.idle,
        backgroundColor: "transparent",
        pointBackgroundColor: theme.surface,
        pointBorderColor: theme.idle,
        tension: 0.28,
        borderWidth: 2,
        pointRadius: 3,
      },
      {
        label: "Overspeed",
        data: rows.map((row) => row.overspeed),
        borderColor: theme.odo,
        backgroundColor: "transparent",
        pointBackgroundColor: theme.surface,
        pointBorderColor: theme.odo,
        tension: 0.28,
        borderWidth: 2,
        pointRadius: 3,
      },
    ],
  };

  const slim = rows.length <= 2;

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    layout: slim ? { padding: { left: 32, right: 32 } } : undefined,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...theme.tooltip,
        callbacks: {
          label(item) {
            return ` ${item.dataset.label}: ${item.parsed.y ?? 0}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: theme.inkSoft,
          font: { family: chartFonts.ui, size: 11 },
          maxRotation: 0,
        },
      },
      y: {
        beginAtZero: true,
        ticks: { ...theme.ticks, stepSize: 1 },
        border: { display: false },
        grid: { color: theme.grid },
        title: { display: true, text: "Events", ...axisTitle },
      },
    },
  };

  return (
    <div className="chart-wrap chart-wrap-sm">
      <Line data={data} options={options} />
    </div>
  );
}
