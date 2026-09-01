import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { BehaviorPeriod } from "../lib/behavior";
import { axisTicks, axisTitle, baseTooltip, chartFonts } from "./chartTheme";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend);

type Props = {
  rows: BehaviorPeriod[];
};

export function BehaviorTrend({ rows }: Props) {
  const data: ChartData<"line"> = {
    labels: rows.map((row) => row.label),
    datasets: [
      {
        label: "Harsh braking",
        data: rows.map((row) => row.harshBraking),
        borderColor: "#0b6b62",
        backgroundColor: "rgba(11, 107, 98, 0.08)",
        pointBackgroundColor: "#fbf9f4",
        pointBorderColor: "#0b6b62",
        tension: 0.28,
        borderWidth: 2,
        pointRadius: 3,
        fill: false,
      },
      {
        label: "Harsh acceleration",
        data: rows.map((row) => row.harshAcceleration),
        borderColor: "#3b4cb3",
        backgroundColor: "transparent",
        pointBackgroundColor: "#fbf9f4",
        pointBorderColor: "#3b4cb3",
        tension: 0.28,
        borderWidth: 2,
        pointRadius: 3,
      },
      {
        label: "Harsh cornering",
        data: rows.map((row) => row.harshCornering),
        borderColor: "#c47d3a",
        backgroundColor: "transparent",
        pointBackgroundColor: "#fbf9f4",
        pointBorderColor: "#c47d3a",
        tension: 0.28,
        borderWidth: 2,
        pointRadius: 3,
      },
      {
        label: "Overspeed",
        data: rows.map((row) => row.overspeed),
        borderColor: "#9a3b12",
        backgroundColor: "transparent",
        pointBackgroundColor: "#fbf9f4",
        pointBorderColor: "#9a3b12",
        tension: 0.28,
        borderWidth: 2,
        pointRadius: 3,
      },
    ],
  };

  const slim = rows.length <= 2;

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    layout: slim ? { padding: { left: 32, right: 32 } } : undefined,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...baseTooltip,
        callbacks: {
          label(item) {
            return ` ${item.dataset.label}: ${item.parsed.y ?? 0}`;
          },
        },
      },
    },
    scales: {
      x: {
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
        ticks: { ...axisTicks, stepSize: 1 },
        border: { display: false },
        grid: { color: "rgba(23, 22, 20, 0.07)" },
        title: { display: true, text: "Events", ...axisTitle },
      },
    },
  };

  return (
    <div className="chart-wrap chart-wrap-sm">
      <Line data={data} options={options} />
    </div>
  );
}
