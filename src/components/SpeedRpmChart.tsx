import {
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
import { axisTitle, chartFonts, useChartTheme } from "./chartTheme";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Filler);

type Props = {
  rows: PeriodMetrics[];
};

export function SpeedRpmChart({ rows }: Props) {
  const theme = useChartTheme();
  const speed = theme.gps;
  const rpm = theme.odo;
  const data: ChartData<"line"> = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "Avg speed",
        data: rows.map((row) => Number(row.avgSpeedKmh.toFixed(1))),
        borderColor: speed,
        backgroundColor: theme.gpsSoft,
        pointBackgroundColor: theme.surface,
        pointBorderColor: speed,
        pointBorderWidth: 2,
        pointRadius: 3.5,
        pointHoverRadius: 5,
        borderWidth: 2,
        tension: 0.28,
        fill: true,
        yAxisID: "ySpeed",
      },
      {
        label: "Max speed",
        data: rows.map((row) => Number(row.maxSpeedKmh.toFixed(1))),
        borderColor: speed,
        backgroundColor: "transparent",
        pointBackgroundColor: speed,
        pointBorderColor: speed,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        borderDash: [5, 4],
        tension: 0.28,
        fill: false,
        yAxisID: "ySpeed",
      },
      {
        label: "Avg RPM",
        data: rows.map((row) => Math.round(row.avgRpm)),
        borderColor: rpm,
        backgroundColor: theme.odoSoft,
        pointBackgroundColor: theme.surface,
        pointBorderColor: rpm,
        pointBorderWidth: 2,
        pointRadius: 3.5,
        pointHoverRadius: 5,
        borderWidth: 2,
        tension: 0.28,
        fill: true,
        yAxisID: "yRpm",
      },
      {
        label: "Max RPM",
        data: rows.map((row) => Math.round(row.maxRpm)),
        borderColor: rpm,
        backgroundColor: "transparent",
        pointBackgroundColor: rpm,
        pointBorderColor: rpm,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        borderDash: [5, 4],
        tension: 0.28,
        fill: false,
        yAxisID: "yRpm",
      },
    ],
  };

  const slim = rows.length <= 2;

  const options: ChartOptions<"line"> = {
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
            const value = Number(item.parsed.y ?? 0);
            const rpm = item.dataset.yAxisID === "yRpm";
            return ` ${item.dataset.label}: ${rpm ? value.toFixed(0) : value.toFixed(1)}${rpm ? "" : " km/h"}`;
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
          autoSkipPadding: 12,
        },
      },
      ySpeed: {
        beginAtZero: true,
        position: "left",
        border: { display: false },
        grid: { color: theme.grid },
        ticks: theme.ticks,
        title: { display: true, text: "Speed (km/h)", ...axisTitle },
      },
      yRpm: {
        beginAtZero: true,
        position: "right",
        border: { display: false },
        grid: { drawOnChartArea: false },
        ticks: theme.ticks,
        title: { display: true, text: "RPM", ...axisTitle },
      },
    },
  };

  return (
    <div className="chart-wrap">
      <Chart type="line" data={data} options={options} />
    </div>
  );
}
