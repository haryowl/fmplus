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

export function FuelChart({ rows }: Props) {
  const data: ChartData = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "CAN used",
        data: rows.map((row) => Number(row.canFuelUsedL.toFixed(2))),
        backgroundColor: "rgba(11, 107, 98, 0.88)",
        hoverBackgroundColor: "#0b6b62",
        borderRadius: 4,
        maxBarThickness: 28,
        barPercentage: 0.86,
        categoryPercentage: 0.55,
      },
      {
        label: "Tank used",
        data: rows.map((row) => Number(row.tankFuelUsedL.toFixed(2))),
        backgroundColor: "rgba(154, 59, 18, 0.82)",
        hoverBackgroundColor: "#9a3b12",
        borderRadius: 4,
        maxBarThickness: 28,
        barPercentage: 0.86,
        categoryPercentage: 0.55,
      },
      {
        label: "Refill detected",
        data: rows.map((row) => Number(row.refillL.toFixed(2))),
        backgroundColor: "rgba(59, 76, 179, 0.82)",
        hoverBackgroundColor: "#3b4cb3",
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
        ...baseTooltip,
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
