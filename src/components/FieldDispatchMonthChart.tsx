import { ArcElement, Chart as ChartJS, Tooltip, type ChartData, type ChartOptions } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { baseTooltip } from "./chartTheme";

ChartJS.register(ArcElement, Tooltip);

export type DispatchMonthJobCounts = {
  pending: number;
  inProgress: number;
  completed: number;
};

const COLORS = ["#c49a5a", "#0b6b62", "#5a7a72"];

type Props = {
  counts: DispatchMonthJobCounts;
  periodLabel: string;
};

function pct(n: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

export function FieldDispatchMonthChart({ counts, periodLabel }: Props) {
  const total = counts.pending + counts.inProgress + counts.completed;
  const data: ChartData<"doughnut"> = {
    labels: ["Pending", "In progress", "Completed"],
    datasets: [
      {
        data: [counts.pending, counts.inProgress, counts.completed],
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
            return ` ${item.label}: ${value} (${pct(value, total)})`;
          },
        },
      },
    },
  };

  return (
    <div className="field-panel field-dispatch-month-chart">
      <header className="field-panel-head">
        <h3>This month</h3>
        <p className="muted">{periodLabel}</p>
      </header>
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
            <span>Pending</span>
            <strong>
              {counts.pending}
              <span className="field-legend-pct">{pct(counts.pending, total)}</span>
            </strong>
          </li>
          <li>
            <span className="field-legend-swatch field-legend-progress" />
            <span>In progress</span>
            <strong>
              {counts.inProgress}
              <span className="field-legend-pct">{pct(counts.inProgress, total)}</span>
            </strong>
          </li>
          <li>
            <span className="field-legend-swatch field-legend-done" />
            <span>Completed</span>
            <strong>
              {counts.completed}
              <span className="field-legend-pct">{pct(counts.completed, total)}</span>
            </strong>
          </li>
        </ul>
      </div>
    </div>
  );
}
