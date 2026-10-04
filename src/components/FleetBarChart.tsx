import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { chartFonts, useChartTheme } from "./chartTheme";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip);

export type FleetSeries = {
  label: string;
  data: number[];
  color: string;
};

type Props = {
  labels: string[];
  series: FleetSeries[];
  unit: string;
  stacked?: boolean;
  type?: "bar" | "line";
  yTitle?: string;
};

export function FleetBarChart({ labels, series, unit, stacked, type = "bar", yTitle }: Props) {
  const theme = useChartTheme();
  const datasets: ChartDataset[] = series.map((item) =>
    type === "line"
      ? {
          type: "line",
          label: item.label,
          data: item.data.map((n) => Number(n.toFixed(2))),
          borderColor: item.color,
          backgroundColor: `${item.color}22`,
          pointBackgroundColor: theme.surface,
          pointBorderColor: item.color,
          pointRadius: 3,
          borderWidth: 2,
          tension: 0.28,
          fill: false,
        }
      : {
          type: "bar",
          label: item.label,
          data: item.data.map((n) => Number(n.toFixed(2))),
          backgroundColor: item.color,
          borderRadius: 3,
          maxBarThickness: stacked ? 36 : 28,
          barPercentage: stacked ? 0.7 : 0.86,
          categoryPercentage: series.length > 4 ? 0.7 : 0.55,
          stack: stacked ? "stack" : undefined,
        },
  );

  const data: ChartData = { labels, datasets };
  const slim = labels.length <= 2;

  const options: ChartOptions = {
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
            return ` ${item.dataset.label}: ${Number(item.parsed.y ?? 0).toFixed(2)} ${unit}`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked: Boolean(stacked),
        offset: true,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: theme.inkSoft,
          font: { family: chartFonts.ui, size: 11 },
          maxRotation: 0,
        },
      },
      y: {
        stacked: Boolean(stacked),
        beginAtZero: true,
        border: { display: false },
        grid: { color: theme.grid },
        ticks: theme.ticks,
        title: { display: Boolean(yTitle), text: yTitle ?? "", ...theme.title },
      },
    },
  };

  return (
    <div className="chart-wrap chart-wrap-sm">
      <Chart type={type === "line" ? "line" : "bar"} data={data} options={options} />
    </div>
  );
}
