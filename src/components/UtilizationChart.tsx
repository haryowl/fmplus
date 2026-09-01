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

export function UtilizationChart({ rows }: Props) {
  const data: ChartData = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "Active (moving)",
        data: rows.map((row) => Number(row.activeHours.toFixed(2))),
        backgroundColor: "rgba(11, 107, 98, 0.88)",
        hoverBackgroundColor: "#0b6b62",
        borderRadius: 3,
        stack: "engine",
        maxBarThickness: 42,
        barPercentage: 0.7,
        categoryPercentage: 0.55,
      },
      {
        label: "Idle (engine on)",
        data: rows.map((row) => Number(row.idleHours.toFixed(2))),
        backgroundColor: "rgba(196, 125, 58, 0.88)",
        hoverBackgroundColor: "#b56a28",
        borderRadius: 3,
        stack: "engine",
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
        ...baseTooltip,
        callbacks: {
          label(item) {
            return ` ${item.dataset.label}: ${Number(item.parsed.y ?? 0).toFixed(2)} h`;
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
          color: "#5e584f",
          font: { family: chartFonts.ui, size: 11 },
          maxRotation: 0,
        },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        border: { display: false },
        grid: { color: "rgba(23, 22, 20, 0.07)" },
        ticks: axisTicks,
        title: { display: true, text: "Hours", ...axisTitle },
      },
    },
  };

  return (
    <div className="chart-wrap chart-wrap-sm">
      <Chart type="bar" data={data} options={options} />
    </div>
  );
}
