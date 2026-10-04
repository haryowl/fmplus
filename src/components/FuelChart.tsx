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

export function FuelChart({ rows }: Props) {
  const theme = useChartTheme();
  const data: ChartData = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "CAN used",
        data: rows.map((row) => Number(row.canFuelUsedL.toFixed(2))),
        backgroundColor: theme.gpsFill,
        hoverBackgroundColor: theme.gps,
        borderRadius: 4,
        maxBarThickness: 28,
        barPercentage: 0.86,
        categoryPercentage: 0.55,
      },
      {
        label: "Tank used",
        data: rows.map((row) => Number(row.tankFuelUsedL.toFixed(2))),
        backgroundColor: theme.odoFill,
        hoverBackgroundColor: theme.odo,
        borderRadius: 4,
        maxBarThickness: 28,
        barPercentage: 0.86,
        categoryPercentage: 0.55,
      },
      {
        label: "Refill detected",
        data: rows.map((row) => Number(row.refillL.toFixed(2))),
        backgroundColor: theme.ignFill,
        hoverBackgroundColor: theme.ign,
        borderRadius: 4,
        maxBarThickness: 28,
        barPercentage: 0.86,
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
            return ` ${item.dataset.label}: ${Number(item.parsed.y ?? 0).toFixed(2)} L`;
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
        title: { display: true, text: "Liters", ...axisTitle },
      },
    },
  };

  return (
    <div className="chart-wrap chart-wrap-sm">
      <Chart type="bar" data={data} options={options} />
    </div>
  );
}
