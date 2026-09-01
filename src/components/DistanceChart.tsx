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

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Filler);

const COLORS = {
  gps: "#0b6b62",
  ign: "#3b4cb3",
  odo: "#9a3b12",
  hrs: "#171614",
};

type Props = {
  rows: PeriodMetrics[];
};

export function DistanceChart({ rows }: Props) {
  const data: ChartData = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        type: "bar",
        label: "GPS · all points",
        data: rows.map((row) => Number(row.gpsDistanceKm.toFixed(2))),
        backgroundColor: "rgba(11, 107, 98, 0.82)",
        hoverBackgroundColor: COLORS.gps,
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
        backgroundColor: "rgba(59, 76, 179, 0.78)",
        hoverBackgroundColor: COLORS.ign,
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
        backgroundColor: "rgba(154, 59, 18, 0.78)",
        hoverBackgroundColor: COLORS.odo,
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
        borderColor: COLORS.hrs,
        backgroundColor: "rgba(23, 22, 20, 0.06)",
        pointBackgroundColor: "#fbf9f4",
        pointBorderColor: COLORS.hrs,
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
        backgroundColor: "#171614",
        titleColor: "#f4efe6",
        bodyColor: "#d9d2c6",
        titleFont: { family: "Plus Jakarta Sans", size: 12, weight: 600 },
        bodyFont: { family: "IBM Plex Mono", size: 11 },
        padding: 12,
        cornerRadius: 8,
        boxPadding: 4,
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
          color: "#5e584f",
          font: { family: "Plus Jakarta Sans", size: 11 },
          maxRotation: 0,
          autoSkipPadding: 12,
        },
      },
      yKm: {
        beginAtZero: true,
        position: "left",
        border: { display: false },
        grid: { color: "rgba(23, 22, 20, 0.07)" },
        ticks: {
          color: "#8a8378",
          font: { family: "IBM Plex Mono", size: 10 },
          callback: (value) => `${value}`,
        },
        title: {
          display: true,
          text: "Distance (km)",
          color: "#8a8378",
          font: { family: "Plus Jakarta Sans", size: 11, weight: 500 },
        },
      },
      yHours: {
        beginAtZero: true,
        position: "right",
        border: { display: false },
        grid: { drawOnChartArea: false },
        ticks: {
          color: "#8a8378",
          font: { family: "IBM Plex Mono", size: 10 },
        },
        title: {
          display: true,
          text: "Active hours",
          color: "#8a8378",
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
