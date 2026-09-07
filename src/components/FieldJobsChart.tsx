import { ArcElement, Chart as ChartJS, Tooltip, type ChartData, type ChartOptions } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { baseTooltip } from "./chartTheme";

ChartJS.register(ArcElement, Tooltip);

export type FieldJobCounts = {
  due: number;
  inProgress: number;
  completed: number;
};

const COLORS = ["#c49a5a", "#0b6b62", "#5a7a72"];

type Props = {
  counts: FieldJobCounts;
};

export function FieldJobsChart({ counts }: Props) {
  const total = counts.due + counts.inProgress + counts.completed;
  const data: ChartData<"doughnut"> = {
    labels: ["Due", "In progress", "Completed"],
    datasets: [
      {
        data: [counts.due, counts.inProgress, counts.completed],
        backgroundColor: COLORS,
        borderWidth: 0,
        hoverOffset: 3,
      },
    ],
  };

  const options: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "68%",
    plugins: {
      legend: { display: false },
      tooltip: {
        ...baseTooltip,
        callbacks: {
          label(item) {
            const value = Number(item.parsed);
            const pct = total > 0 ? (value / total) * 100 : 0;
            return ` ${item.label}: ${value} (${pct.toFixed(0)}%)`;
          },
        },
      },
    },
  };

  return (
    <div className="field-jobs-chart">
      <div className="field-jobs-doughnut">
        {total === 0 ? (
          <div className="field-jobs-doughnut-empty">No jobs</div>
        ) : (
          <>
            <Doughnut data={data} options={options} />
            <div className="field-jobs-doughnut-center" aria-hidden>
              <strong>{total}</strong>
              <span>jobs</span>
            </div>
          </>
        )}
      </div>
      <ul className="field-jobs-legend">
        <li>
          <span className="field-legend-swatch field-legend-due" />
          <span>Due</span>
          <strong>{counts.due}</strong>
        </li>
        <li>
          <span className="field-legend-swatch field-legend-progress" />
          <span>In progress</span>
          <strong>{counts.inProgress}</strong>
        </li>
        <li>
          <span className="field-legend-swatch field-legend-done" />
          <span>Completed</span>
          <strong>{counts.completed}</strong>
        </li>
      </ul>
      <p className="field-jobs-chart-note">Assigned to you · last 6 months</p>
    </div>
  );
}
