import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { BehaviorSummary } from "./behavior";
import { formatHours, formatIdr, formatKm, formatKmPerL, formatLiters, formatMeters, formatRpm, formatSpeed } from "./format";
import type { InsightBlock } from "./insight";
import type { PeriodMetrics } from "./types";

function tableBottom(doc: jsPDF): number {
  return (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40;
}

function sectionTitle(doc: jsPDF, title: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(23, 22, 20);
  doc.text(title, 14, y);
  return y + 4;
}

function safeName(value: string): string {
  return value.replace(/[^\w.-]+/g, "_").slice(0, 60);
}

export function exportMetricsPdf(options: {
  vehicle: string;
  group: string;
  dateFrom: string;
  dateTo: string;
  timezone: string;
  period: string;
  rows: PeriodMetrics[];
  behavior: BehaviorSummary | null;
  insights?: InsightBlock[];
}): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const { vehicle, group, dateFrom, dateTo, timezone, period, rows, behavior, insights } = options;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(23, 22, 20);
  doc.text("Vehicle Metrics", 14, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(94, 88, 79);
  doc.text(`${vehicle} · ${group}`, 14, 23);
  doc.text(`${dateFrom} → ${dateTo} · ${timezone} · ${period}`, 14, 28);

  autoTable(doc, {
    startY: 34,
    head: [
      [
        "Period",
        "Trips",
        "GPS km",
        "Ignition km",
        "Odometer km",
        "Active h",
        "Idle h",
        "Fuel L",
        "Refill L",
        "km/l",
        "Cost",
      ],
    ],
    body: rows.map((row) => [
      row.label,
      String(row.tripCount),
      formatKm(row.gpsDistanceKm),
      formatKm(row.ignitionDistanceKm),
      formatKm(row.odometerKm),
      formatHours(row.activeHours),
      formatHours(row.idleHours),
      formatLiters(row.fuelUsedL),
      formatLiters(row.refillL),
      row.kmPerL > 0 ? formatKmPerL(row.kmPerL) : "—",
      formatIdr(row.fuelCost),
    ]),
    styles: { fontSize: 8, cellPadding: 1.6, textColor: [23, 22, 20] },
    headStyles: { fillColor: [11, 107, 98], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [243, 239, 231] },
    margin: { left: 14, right: 14 },
  });

  const fuelY = sectionTitle(doc, "Fuel sensors", tableBottom(doc) + 10);
  autoTable(doc, {
    startY: fuelY,
    head: [["Period", "Used L", "CAN L", "Tank L", "Refill L"]],
    body: rows.map((row) => [
      row.label,
      formatLiters(row.fuelUsedL),
      row.canFuelUsedL > 0 ? formatLiters(row.canFuelUsedL) : "—",
      row.tankFuelUsedL > 0 ? formatLiters(row.tankFuelUsedL) : "—",
      formatLiters(row.refillL),
    ]),
    styles: { fontSize: 8, cellPadding: 1.6, textColor: [23, 22, 20] },
    headStyles: { fillColor: [11, 107, 98], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [243, 239, 231] },
    margin: { left: 14, right: 14 },
  });

  const hasAltitude = rows.some((row) => row.altitudeSamples > 0);
  if (hasAltitude) {
    const terrainY = sectionTitle(doc, "Terrain & efficiency", tableBottom(doc) + 10);
    autoTable(doc, {
      startY: terrainY,
      head: [["Period", "Gain (m)", "Loss (m)", "Min alt", "Max alt", "Impact", "km/l", "Flat km/l"]],
      body: rows.map((row) => [
        row.label,
        row.altitudeSamples > 0 ? String(Math.round(row.elevationGainM)) : "—",
        row.altitudeSamples > 0 ? String(Math.round(row.elevationLossM)) : "—",
        row.altitudeMinM !== null ? formatMeters(row.altitudeMinM) : "—",
        row.altitudeMaxM !== null ? formatMeters(row.altitudeMaxM) : "—",
        row.terrainImpactPct > 0 ? `${row.terrainImpactPct.toFixed(1)}%` : "—",
        row.kmPerL > 0 ? formatKmPerL(row.kmPerL) : "—",
        row.flatKmPerL > 0 ? formatKmPerL(row.flatKmPerL) : "—",
      ]),
      styles: { fontSize: 8, cellPadding: 1.6, textColor: [23, 22, 20] },
      headStyles: { fillColor: [154, 59, 18], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [243, 239, 231] },
      margin: { left: 14, right: 14 },
    });
  }

  const speedY = sectionTitle(doc, "Speed & RPM", tableBottom(doc) + 10);
  autoTable(doc, {
    startY: speedY,
    head: [["Period", "Avg km/h", "Max km/h", "Avg RPM", "Max RPM"]],
    body: rows.map((row) => [
      row.label,
      row.avgSpeedKmh > 0 ? formatSpeed(row.avgSpeedKmh) : "—",
      row.maxSpeedKmh > 0 ? formatSpeed(row.maxSpeedKmh) : "—",
      row.avgRpm > 0 ? formatRpm(row.avgRpm) : "—",
      row.maxRpm > 0 ? formatRpm(row.maxRpm) : "—",
    ]),
    styles: { fontSize: 8, cellPadding: 1.6, textColor: [23, 22, 20] },
    headStyles: { fillColor: [154, 59, 18], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [243, 239, 231] },
    margin: { left: 14, right: 14 },
  });

  if (behavior && behavior.rows.length > 0) {
    const startY = sectionTitle(doc, "Driving behavior", tableBottom(doc) + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(94, 88, 79);
    doc.text(
      `Safety score ${behavior.safetyScore.toFixed(0)}/100 · ${behavior.eventsPer100km.toFixed(2)} events/100 km`,
      14,
      startY,
    );

    autoTable(doc, {
      startY: startY + 4,
      head: [["Period", "Braking", "Acceleration", "Cornering", "Overspeed"]],
      body: behavior.rows.map((row) => [
        row.label,
        String(row.harshBraking),
        String(row.harshAcceleration),
        String(row.harshCornering),
        String(row.overspeed),
      ]),
      styles: { fontSize: 8, cellPadding: 1.6, textColor: [23, 22, 20] },
      headStyles: { fillColor: [23, 22, 20], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [243, 239, 231] },
      margin: { left: 14, right: 14 },
    });
  }

  const hasRoad = rows.some((row) => row.roadSamples > 0);
  if (hasRoad) {
    const roadY = sectionTitle(doc, "Road condition", tableBottom(doc) + 10);
    autoTable(doc, {
      startY: roadY,
      head: [["Period", "Smooth", "Rough", "Bumpy", "Avg mG", "Max mG"]],
      body: rows.map((row) => [
        row.label,
        row.roadSamples > 0 ? `${row.roadSmoothPct.toFixed(1)}%` : "—",
        row.roadSamples > 0 ? `${row.roadRoughPct.toFixed(1)}%` : "—",
        row.roadSamples > 0 ? `${row.roadBumpyPct.toFixed(1)}%` : "—",
        row.roadSamples > 0 ? String(Math.round(row.avgVibrationMg)) : "—",
        row.roadSamples > 0 ? String(Math.round(row.maxVibrationMg)) : "—",
      ]),
      styles: { fontSize: 8, cellPadding: 1.6, textColor: [23, 22, 20] },
      headStyles: { fillColor: [11, 107, 98], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [243, 239, 231] },
      margin: { left: 14, right: 14 },
    });
  }

  if (insights && insights.length > 0) {
    let y = sectionTitle(doc, "Vehicle analysis", tableBottom(doc) + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(23, 22, 20);
    for (const block of insights) {
      if (y > 190) {
        doc.addPage();
        y = 16;
      }
      doc.setFont("helvetica", "bold");
      doc.text(block.title, 14, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(block.body, 269);
      doc.text(lines, 14, y);
      y += lines.length * 4.2 + 4;
    }
  }

  doc.save(`vehicle_metrics_${safeName(vehicle)}_${dateFrom}_${dateTo}.pdf`);
}
