export const FAT_OXIDATION_MODEL_VERSION = "paul-lactate-hr-v1";

export interface FatOxidationRateRange {
  low: number;
  high: number;
  midpoint: number;
}

export interface FatOxidationEstimate {
  grams: number;
  gramsLow: number;
  gramsHigh: number;
  kcalFromFat: number;
  kcalFromFatLow: number;
  kcalFromFatHigh: number;
  averageRateGramsPerMinute: number;
  coveredSeconds: number;
  totalSeconds: number;
  coverage: number;
  model: string;
  lt1Bpm: number;
  lt2Bpm: number;
}

interface ModelPoint {
  bpm: number;
  low: number;
  high: number;
}

/**
 * Working athlete-specific model derived from Paul's measured running lactate anchors
 * (LT1 ~144 bpm, LT2 ~165 bpm) and the conservative fat-oxidation ranges agreed for
 * Activity Analysis. Values are estimates, not indirect-calorimetry measurements.
 */
const MODEL: ModelPoint[] = [
  { bpm: 90, low: 0.03, high: 0.10 },
  { bpm: 110, low: 0.12, high: 0.25 },
  { bpm: 120, low: 0.22, high: 0.38 },
  { bpm: 130, low: 0.35, high: 0.50 },
  { bpm: 135, low: 0.45, high: 0.60 },
  { bpm: 140, low: 0.45, high: 0.65 },
  { bpm: 144, low: 0.35, high: 0.55 },
  { bpm: 150, low: 0.25, high: 0.45 },
  { bpm: 155, low: 0.15, high: 0.30 },
  { bpm: 160, low: 0.10, high: 0.20 },
  { bpm: 165, low: 0.05, high: 0.20 },
  { bpm: 175, low: 0.00, high: 0.10 },
  { bpm: 190, low: 0.00, high: 0.05 },
  { bpm: 210, low: 0.00, high: 0.02 },
];

const round = (value: number, precision = 1) => Math.round(value * 10 ** precision) / 10 ** precision;
const midpoint = (low: number, high: number) => (low + high) / 2;

export function fatOxidationRateForHeartRate(bpm: number): FatOxidationRateRange | null {
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  if (bpm <= MODEL[0].bpm) {
    const point = MODEL[0];
    return { low: point.low, high: point.high, midpoint: midpoint(point.low, point.high) };
  }
  if (bpm >= MODEL[MODEL.length - 1].bpm) {
    const point = MODEL[MODEL.length - 1];
    return { low: point.low, high: point.high, midpoint: midpoint(point.low, point.high) };
  }

  for (let i = 1; i < MODEL.length; i++) {
    const upper = MODEL[i];
    const lower = MODEL[i - 1];
    if (bpm > upper.bpm) continue;
    const fraction = (bpm - lower.bpm) / (upper.bpm - lower.bpm);
    const low = lower.low + (upper.low - lower.low) * fraction;
    const high = lower.high + (upper.high - lower.high) * fraction;
    return { low, high, midpoint: midpoint(low, high) };
  }
  return null;
}

/** Integrate estimated fat oxidation over recorded HR samples. */
export function estimateFatOxidation(
  elapsedSeconds: number[],
  heartRate: Array<number | null> | undefined,
  options: { range?: [number, number] | null; breakBefore?: boolean[] } = {},
): FatOxidationEstimate | null {
  if (!heartRate || elapsedSeconds.length < 2 || heartRate.length < 2) return null;

  const last = Math.min(elapsedSeconds.length, heartRate.length) - 1;
  const rawStart = options.range?.[0] ?? 0;
  const rawEnd = options.range?.[1] ?? last;
  const start = Math.max(0, Math.min(last, Math.min(rawStart, rawEnd)));
  const end = Math.max(0, Math.min(last, Math.max(rawStart, rawEnd)));
  if (end <= start) return null;

  const totalSeconds = Math.max(0, elapsedSeconds[end] - elapsedSeconds[start]);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;

  let gramsLow = 0;
  let gramsHigh = 0;
  let coveredSeconds = 0;

  for (let i = start; i < end; i++) {
    const dt = elapsedSeconds[i + 1] - elapsedSeconds[i];
    if (!Number.isFinite(dt) || dt <= 0 || dt > 30 || options.breakBefore?.[i + 1]) continue;

    const r0 = fatOxidationRateForHeartRate(heartRate[i] ?? Number.NaN);
    const r1 = fatOxidationRateForHeartRate(heartRate[i + 1] ?? Number.NaN);
    if (!r0 || !r1) continue;

    const minutes = dt / 60;
    gramsLow += ((r0.low + r1.low) / 2) * minutes;
    gramsHigh += ((r0.high + r1.high) / 2) * minutes;
    coveredSeconds += dt;
  }

  if (coveredSeconds <= 0) return null;
  const grams = midpoint(gramsLow, gramsHigh);
  return {
    grams: round(grams),
    gramsLow: round(gramsLow),
    gramsHigh: round(gramsHigh),
    kcalFromFat: round(grams * 9),
    kcalFromFatLow: round(gramsLow * 9),
    kcalFromFatHigh: round(gramsHigh * 9),
    averageRateGramsPerMinute: round(grams / (coveredSeconds / 60), 2),
    coveredSeconds: round(coveredSeconds, 0),
    totalSeconds: round(totalSeconds, 0),
    coverage: round(coveredSeconds / totalSeconds, 3),
    model: FAT_OXIDATION_MODEL_VERSION,
    lt1Bpm: 144,
    lt2Bpm: 165,
  };
}
