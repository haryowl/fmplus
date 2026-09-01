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
import { axisTicks, axisTitle, baseTooltip, chartFonts } from "./chartTheme";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Filler);

const SPEED = "#0b6b62";
const RPM = "#9a3b12";

type Props = {
  rows: PeriodMetrics[];
};

export function SpeedRpmChart({ rows }: Props) {
  const data: ChartData<"line"> = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "Avg speed",
        data: rows.map((row) => Number(row.avgSpeedKmh.toFixed(1))),
        borderColor: SPEED,
        backgroundColor: "rgba(11, 107, 98, 0.08)",
        pointBackgroundColor: "#fbf9f4",
        pointBorderColor: SPEED,
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
        borderColor: SPEED,
        backgroundColor: "transparent",
        pointBackgroundColor: SPEED,
        pointBorderColor: SPEED,
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
        borderColor: RPM,
        backgroundColor: "rgba(154, 59, 18, 0.07)",
        pointBackgroundColor: "#fbf9f4",
        pointBorderColor: RPM,
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
        borderColor: RPM,
        backgroundColor: "transparent",
        pointBackgroundColor: RPM,
        pointBorderColor: RPM,
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
        ...baseTooltip,
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
          color: "#5e584f",
          font: { family: chartFonts.ui, size: 11 },
          maxRotation: 0,
          autoSkipPadding: 12,
        },
      },
      ySpeed: {
        beginAtZero: true,
        position: "left",
        border: { display: false },
        grid: { color: "rgba(23, 22, 20, 0.07)" },
        ticks: axisTicks,
        title: { display: true, text: "Speed (km/h)", ...axisTitle },
      },
      yRpm: {
        beginAtZero: true,
        position: "right",
        border: { display: false },
        grid: { drawOnChartArea: false },
        ticks: axisTicks,
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
