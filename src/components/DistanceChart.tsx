import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import type { PeriodMetrics } from "../lib/types";
import { useChartTheme } from "./chartTheme";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Filler);

type Props = {
  rows: PeriodMetrics[];
};

export function DistanceChart({ rows }: Props) {
  const theme = useChartTheme();
  const data: ChartData = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        type: "bar",
        label: "GPS · all points",
        data: rows.map((row) => Number(row.gpsDistanceKm.toFixed(2))),
        backgroundColor: theme.gpsFill,
        hoverBackgroundColor: theme.gps,
        borderRadius: 4,
        barPercentage: 0.86,
        categoryPercentage: 0.5,
        maxBarThickness: 28,
        yAxisID: "yKm",
        order: 2,
      },
      {
        type: "bar",
        label: "GPS · ignition on",
        data: rows.map((row) => Number(row.ignitionDistanceKm.toFixed(2))),
        backgroundColor: theme.ignFill,
        hoverBackgroundColor: theme.ign,
        borderRadius: 4,
        barPercentage: 0.86,
        categoryPercentage: 0.5,
        maxBarThickness: 28,
        yAxisID: "yKm",
        order: 2,
      },
      {
        type: "bar",
        label: "Odometer",
        data: rows.map((row) => Number(row.odometerKm.toFixed(2))),
        backgroundColor: theme.odoFill,
        hoverBackgroundColor: theme.odo,
        borderRadius: 4,
        barPercentage: 0.86,
        categoryPercentage: 0.5,
        maxBarThickness: 28,
        yAxisID: "yKm",
        order: 2,
      },
      {
        type: "line",
        label: "Active hours",
        data: rows.map((row) => Number(row.activeHours.toFixed(2))),
        borderColor: theme.hrs,
        backgroundColor: theme.hrsFill,
        pointBackgroundColor: theme.surface,
        pointBorderColor: theme.hrs,
        pointBorderWidth: 2,
        pointRadius: 3.5,
        pointHoverRadius: 5,
        borderWidth: 2,
        tension: 0.28,
        fill: true,
        yAxisID: "yHours",
        order: 1,
      },
    ],
  };

  const slim = rows.length <= 2;

  const options: ChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: slim ? { padding: { left: 80, right: 80 } } : undefined,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...theme.tooltip,
        callbacks: {
          label(item) {
            const value = Number(item.parsed.y ?? 0);
            const suffix = item.dataset.yAxisID === "yHours" ? " h" : " km";
            return ` ${item.dataset.label}: ${value.toFixed(2)}${suffix}`;
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
          font: { family: "Plus Jakarta Sans", size: 11 },
          maxRotation: 0,
          autoSkipPadding: 12,
        },
      },
      yKm: {
        beginAtZero: true,
        position: "left",
        border: { display: false },
        grid: { color: theme.grid },
        ticks: {
          color: theme.inkFaint,
          font: { family: "IBM Plex Mono", size: 10 },
          callback: (value) => `${value}`,
        },
        title: {
          display: true,
          text: "Distance (km)",
          color: theme.inkFaint,
          font: { family: "Plus Jakarta Sans", size: 11, weight: 500 },
        },
      },
      yHours: {
        beginAtZero: true,
        position: "right",
        border: { display: false },
        grid: { drawOnChartArea: false },
        ticks: {
          color: theme.inkFaint,
          font: { family: "IBM Plex Mono", size: 10 },
        },
        title: {
          display: true,
          text: "Active hours",
          color: theme.inkFaint,
          font: { family: "Plus Jakarta Sans", size: 11, weight: 500 },
        },
      },
    },
  };

  return (
    <div className="chart-wrap">
      <Chart type="bar" data={data} options={options} />
    </div>
  );
}
