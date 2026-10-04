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

export function ElevationChart({ rows }: Props) {
  const theme = useChartTheme();
  const data: ChartData = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "Elevation gain",
        data: rows.map((row) => Number(row.elevationGainM.toFixed(0))),
        backgroundColor: theme.odoFill,
        hoverBackgroundColor: theme.odo,
        borderRadius: 4,
        maxBarThickness: 28,
        barPercentage: 0.86,
        categoryPercentage: 0.5,
      },
      {
        label: "Elevation loss",
        data: rows.map((row) => Number(row.elevationLossM.toFixed(0))),
        backgroundColor: theme.gpsFill,
        hoverBackgroundColor: theme.gps,
        borderRadius: 4,
        maxBarThickness: 28,
        barPercentage: 0.86,
        categoryPercentage: 0.5,
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
            return ` ${item.dataset.label}: ${Math.round(Number(item.parsed.y ?? 0))} m`;
          },
        },
      },
    },
    scales: {
      x: {
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
        beginAtZero: true,
        border: { display: false },
        grid: { color: theme.grid },
        ticks: theme.ticks,
        title: { display: true, text: "Metres", ...axisTitle },
      },
    },
  };

  return (
    <div className="chart-wrap chart-wrap-sm">
      <Chart type="bar" data={data} options={options} />
    </div>
  );
}
