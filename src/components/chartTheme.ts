import type { ChartOptions } from "chart.js";

export const chartFonts = {
  ui: "Plus Jakarta Sans",
  mono: "IBM Plex Mono",
};

export const baseTooltip: NonNullable<ChartOptions["plugins"]>["tooltip"] = {
  backgroundColor: "#171614",
  titleColor: "#f4efe6",
  bodyColor: "#d9d2c6",
  titleFont: { family: chartFonts.ui, size: 12, weight: 600 },
  bodyFont: { family: chartFonts.mono, size: 11 },
  padding: 12,
  cornerRadius: 8,
  boxPadding: 4,
};

export const axisTitle = {
  color: "#8a8378",
  font: { family: chartFonts.ui, size: 11, weight: 500 as const },
};

export const axisTicks = {
  color: "#8a8378",
  font: { family: chartFonts.mono, size: 10 },
};
