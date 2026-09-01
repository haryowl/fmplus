import { ROAD_BUMPY_MG, ROAD_ROUGH_MG } from "./config";

export type AxisSample = {
  x: number;
  y: number;
  z: number;
};

export type RoadStats = {
  smoothCount: number;
  roughCount: number;
  bumpyCount: number;
  samples: number;
  avgVibrationMg: number;
  maxVibrationMg: number;
};

export function vibrationMg(sample: AxisSample): number {
  return Math.hypot(sample.x, sample.y, sample.z);
}

export function classifyVibration(magnitudeMg: number): "smooth" | "rough" | "bumpy" {
  if (magnitudeMg > ROAD_BUMPY_MG) return "bumpy";
  if (magnitudeMg > ROAD_ROUGH_MG) return "rough";
  return "smooth";
}

export function roadFromSamples(samples: AxisSample[]): RoadStats {
  let smoothCount = 0;
  let roughCount = 0;
  let bumpyCount = 0;
  let magSum = 0;
  let maxVibrationMg = 0;

  for (const sample of samples) {
    const mag = vibrationMg(sample);
    magSum += mag;
    if (mag > maxVibrationMg) maxVibrationMg = mag;
    const bucket = classifyVibration(mag);
    if (bucket === "bumpy") bumpyCount += 1;
    else if (bucket === "rough") roughCount += 1;
    else smoothCount += 1;
  }

  const samplesN = samples.length;
  return {
    smoothCount,
    roughCount,
    bumpyCount,
    samples: samplesN,
    avgVibrationMg: samplesN > 0 ? magSum / samplesN : 0,
    maxVibrationMg,
  };
}

export function roadSharePct(count: number, samples: number): number {
  return samples > 0 ? (count / samples) * 100 : 0;
}
