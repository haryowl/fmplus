import { ArcElement, Chart as ChartJS, Legend, Tooltip, type ChartData, type ChartOptions } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import type { BehaviorSummary } from "../lib/behavior";
import { baseTooltip } from "./chartTheme";

ChartJS.register(ArcElement, Tooltip, Legend);

const COLORS = ["#0b6b62", "#3b4cb3", "#c47d3a", "#9a3b12"];

type Props = {
  summary: BehaviorSummary;
};

export function BehaviorDoughnut({ summary }: Props) {
  const data: ChartData<"doughnut"> = {
    labels: ["Harsh braking", "Harsh acceleration", "Harsh cornering", "Overspeed"],
    datasets: [
      {
        data: [
          summary.harshBraking,
          summary.harshAcceleration,
          summary.harshCornering,
          summary.overspeed,
        ],
        backgroundColor: COLORS,
        borderWidth: 0,
        hoverOffset: 4,
      },
    ],
  };

  const empty = summary.totalEvents === 0;

  const options: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "62%",
    plugins: {
      legend: { display: false },
      tooltip: {
        ...baseTooltip,
        callbacks: {
          label(item) {
            const value = Number(item.parsed);
            const pct = summary.totalEvents > 0 ? (value / summary.totalEvents) * 100 : 0;
            return ` ${item.label}: ${value} (${pct.toFixed(0)}%)`;
          },
        },
      },
    },
  };

  return (
    <div className="chart-wrap chart-wrap-sm doughnut-wrap">
      {empty ? (
        <div className="doughnut-empty">No harsh or overspeed events in this range.</div>
      ) : (
        <Doughnut data={data} options={options} />
      )}
    </div>
  );
}
