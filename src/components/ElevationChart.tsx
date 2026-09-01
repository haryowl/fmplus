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
import { axisTicks, axisTitle, baseTooltip, chartFonts } from "./chartTheme";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

type Props = {
  rows: PeriodMetrics[];
};

export function ElevationChart({ rows }: Props) {
  const data: ChartData = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "Elevation gain",
        data: rows.map((row) => Number(row.elevationGainM.toFixed(0))),
        backgroundColor: "rgba(154, 59, 18, 0.82)",
        hoverBackgroundColor: "#9a3b12",
        borderRadius: 4,
        maxBarThickness: 28,
        barPercentage: 0.86,
        categoryPercentage: 0.5,
      },
      {
        label: "Elevation loss",
        data: rows.map((row) => Number(row.elevationLossM.toFixed(0))),
        backgroundColor: "rgba(11, 107, 98, 0.82)",
        hoverBackgroundColor: "#0b6b62",
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
        ...baseTooltip,
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
          color: "#5e584f",
          font: { family: chartFonts.ui, size: 11 },
          maxRotation: 0,
        },
      },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: "rgba(23, 22, 20, 0.07)" },
        ticks: axisTicks,
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
