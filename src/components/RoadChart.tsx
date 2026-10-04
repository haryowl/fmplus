import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import type { PeriodMetrics } from "../lib/types";
import { axisTitle, chartFonts, useChartTheme } from "./chartTheme";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

type Props = {
  rows: PeriodMetrics[];
};

export function RoadChart({ rows }: Props) {
  const theme = useChartTheme();
  const data: ChartData = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "Smooth",
        data: rows.map((row) => Number(row.roadSmoothPct.toFixed(1))),
        backgroundColor: theme.gpsFill,
        hoverBackgroundColor: theme.gps,
        borderRadius: 3,
        stack: "road",
        maxBarThickness: 42,
        barPercentage: 0.7,
        categoryPercentage: 0.55,
      },
      {
        label: "Rough",
        data: rows.map((row) => Number(row.roadRoughPct.toFixed(1))),
        backgroundColor: theme.idleFill,
        hoverBackgroundColor: theme.idle,
        borderRadius: 3,
        stack: "road",
        maxBarThickness: 42,
        barPercentage: 0.7,
        categoryPercentage: 0.55,
      },
      {
        label: "Bumpy",
        data: rows.map((row) => Number(row.roadBumpyPct.toFixed(1))),
        backgroundColor: theme.dangerFill,
        hoverBackgroundColor: theme.danger,
        borderRadius: 3,
        stack: "road",
        maxBarThickness: 42,
        barPercentage: 0.7,
        categoryPercentage: 0.55,
      },
    ],
  };

  const slim = rows.length <= 2;

  const options: ChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: slim ? { padding: { left: 48, right: 48 } } : undefined,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...theme.tooltip,
        callbacks: {
          label(item) {
            return ` ${item.dataset.label}: ${Number(item.parsed.y ?? 0).toFixed(1)}%`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        offset: true,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: theme.inkSoft,
          font: { family: chartFonts.ui, size: 11 },
          maxRotation: 0,
        },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        max: 100,
        border: { display: false },
        grid: { color: theme.grid },
        ticks: theme.ticks,
        title: { display: true, text: "Share of points (%)", ...axisTitle },
      },
    },
  };

  return (
    <div className="chart-wrap chart-wrap-sm">
      <Chart type="bar" data={data} options={options} />
    </div>
  );
}
