import type { WorkoutRevision, WorkoutStep } from "../domain/contracts";
import {
  CHANNELS,
  nearestIndex,
  type AnalysisProjection,
  type AnalysisZone,
  type Channel,
  type IndexRange,
} from "./projection";
import { rangeSummary } from "./selection";

export const INTELLIGENCE_VERSION = "1.1.0";

export interface IntervalMetrics {
  durationSeconds: number;
  distanceMeters: number | null;
  averageSpeedMps: number | null;
  averagePaceSecPerKm: number | null;
  averageHeartRateBpm: number | null;
  averageCadenceSpm: number | null;
  averagePowerWatts: number | null;
  elevationGainMeters: number | null;
}

export interface PlannedTarget {
  channel: "heart_rate" | "pace" | "cadence" | "power";
  lower: number;
  upper: number;
  unit: string;
}

export interface AnalysisInterval {
  id: string;
  label: string;
  source: "recorded" | "detected" | "planned" | "custom";
  start: number;
  end: number;
  phase?: string;
  metrics: IntervalMetrics;
  target?: PlannedTarget;
  compliancePercent?: number | null;
}

export interface ZoneBucket {
  name: string;
  color: string;
  lower: number | null;
  upper: number | null;
  seconds: number;
  percentage: number;
}

export interface ZoneDistribution {
  channel: Channel;
  totalSeconds: number;
  classifiedSeconds: number;
  unclassifiedSeconds: number;
  zones: ZoneBucket[];
}

export interface HistogramBin {
  lower: number;
  upper: number;
  count: number;
  percentage: number;
}

export interface ScatterSample {
  index: number;
  x: number;
  y: number;
}

export interface HeatmapCell {
  xBin: number;
  yBin: number;
  xLower: number;
  xUpper: number;
  yLower: number;
  yUpper: number;
  count: number;
  indices: number[];
}

export interface BestEffort {
  id: string;
  label: string;
  basis: "duration" | "distance";
  start: number;
  end: number;
  durationSeconds: number;
  distanceMeters: number;
  averageSpeedMps: number;
  averagePaceSecPerKm: number;
  averageHeartRateBpm: number | null;
  averagePowerWatts: number | null;
  averageCadenceSpm: number | null;
}

export interface EfficiencyAnalysis {
  range: IndexRange;
  averageSpeedMps: number | null;
  averageHeartRateBpm: number | null;
  speedPerHeartBeat: number | null;
  powerPerHeartBeat: number | null;
  firstHalfSpeedPerHeartBeat: number | null;
  secondHalfSpeedPerHeartBeat: number | null;
  aerobicDecouplingPercent: number | null;
}

export interface PeakSignalEffort {
  id: string;
  channel: "speed" | "heart_rate" | "power" | "cadence";
  windowSeconds: number;
  start: number;
  end: number;
  average: number;
}

export interface DerivedRunningMetrics {
  range: IndexRange;
  gradeAdjustedPaceSecPerKm: number | null;
  elevationGainMeters: number;
  elevationLossMeters: number;
  uphillSeconds: number;
  downhillSeconds: number;
  flatSeconds: number;
  internalLoadScore: number | null;
  loadFormula: string;
}

export interface PlannedActualSummary {
  workoutId: string;
  workoutVersion: number;
  workoutName: string;
  stepCount: number;
  measuredStepCount: number;
  compliantStepCount: number;
  compliancePercent: number | null;
}

export interface ActivityIntelligence {
  version: string;
  intervals: AnalysisInterval[];
  zoneDistributions: ZoneDistribution[];
  bestEfforts: BestEffort[];
  peakSignals: PeakSignalEffort[];
  efficiency: EfficiencyAnalysis | null;
  derivedRunning: DerivedRunningMetrics;
  plannedActual?: PlannedActualSummary;
  algorithms: Record<string, string>;
}

function boundedRange(projection: AnalysisProjection, range?: IndexRange | null): IndexRange {
  const last = Math.max(0, projection.streams.elapsed.length - 1);
  const start = Math.max(0, Math.min(last, range?.[0] ?? 0));
  const end = Math.max(start, Math.min(last, range?.[1] ?? last));
  return [start, end];
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.floor((ordered.length - 1) * fraction)))];
}

export function intervalMetrics(projection: AnalysisProjection, inputRange: IndexRange): IntervalMetrics {
  const [start, end] = boundedRange(projection, inputRange);
  const summary = rangeSummary(projection, [start, end]);
  const altitude = projection.streams.channels.altitude;
  let ascent = 0;
  let ascentSamples = 0;
  if (altitude) {
    for (let index = start + 1; index <= end; index++) {
      const previous = altitude[index - 1];
      const current = altitude[index];
      if (!projection.streams.breakBefore[index] && finite(previous) && finite(current) && current > previous) {
        ascent += current - previous;
        ascentSamples++;
      }
    }
  }
  const averageSpeed = summary.means.speed ?? (summary.distance !== null && summary.duration > 0 ? summary.distance / summary.duration : null);
  return {
    durationSeconds: summary.duration,
    distanceMeters: summary.distance,
    averageSpeedMps: averageSpeed ?? null,
    averagePaceSecPerKm: finite(averageSpeed) && averageSpeed > 0 ? 1000 / averageSpeed : null,
    averageHeartRateBpm: summary.means.heart_rate ?? null,
    averageCadenceSpm: summary.means.cadence ?? null,
    averagePowerWatts: summary.means.power ?? null,
    elevationGainMeters: ascentSamples ? ascent : null,
  };
}

export function recordedIntervals(projection: AnalysisProjection): AnalysisInterval[] {
  return projection.laps.map((lap, index) => ({
    id: `recorded-${lap.id}`,
    label: lap.label || `Lap ${index + 1}`,
    source: "recorded",
    start: lap.start,
    end: lap.end,
    metrics: intervalMetrics(projection, [lap.start, lap.end]),
  }));
}

export function customInterval(projection: AnalysisProjection, range: IndexRange, sequence: number): AnalysisInterval {
  const [start, end] = boundedRange(projection, range);
  return {
    id: `custom-${sequence}-${start}-${end}`,
    label: `Custom interval ${sequence}`,
    source: "custom",
    start,
    end,
    metrics: intervalMetrics(projection, [start, end]),
  };
}

export function detectEffortIntervals(
  projection: AnalysisProjection,
  options: { minimumSeconds?: number; mergeGapSeconds?: number } = {},
): AnalysisInterval[] {
  const speed = projection.streams.channels.speed;
  if (!speed || speed.length < 3) return [];
  const threshold = quantile(speed.filter((value): value is number => finite(value) && value > 0), 0.72);
  if (!finite(threshold)) return [];
  const minimumSeconds = options.minimumSeconds ?? 45;
  const mergeGap = options.mergeGapSeconds ?? 20;
  const ranges: IndexRange[] = [];
  let start: number | null = null;
  let lastAbove: number | null = null;
  for (let index = 0; index < speed.length; index++) {
    const above = finite(speed[index]) && speed[index]! >= threshold && !projection.streams.breakBefore[index];
    if (above) {
      if (start === null) start = index;
      lastAbove = index;
      continue;
    }
    if (start !== null && lastAbove !== null) {
      const gap = projection.streams.elapsed[index] - projection.streams.elapsed[lastAbove];
      if (gap > mergeGap) {
        if (projection.streams.elapsed[lastAbove] - projection.streams.elapsed[start] >= minimumSeconds) ranges.push([start, lastAbove]);
        start = null;
        lastAbove = null;
      }
    }
  }
  if (start !== null && lastAbove !== null && projection.streams.elapsed[lastAbove] - projection.streams.elapsed[start] >= minimumSeconds) ranges.push([start, lastAbove]);
  return ranges.map((range, index) => ({
    id: `detected-${index + 1}`,
    label: `Detected effort ${index + 1}`,
    source: "detected",
    start: range[0],
    end: range[1],
    metrics: intervalMetrics(projection, range),
  }));
}

function flattenWorkoutSteps(steps: WorkoutStep[]): WorkoutStep[] {
  return steps.flatMap(step => step.kind === "repeat"
    ? Array.from({ length: step.repeatCount }, () => flattenWorkoutSteps(step.children)).flat()
    : [step]);
}

function targetForStep(step: Extract<WorkoutStep, { kind: "step" }>): PlannedTarget | undefined {
  if (step.targetType === "none" || !finite(step.targetLow)) return undefined;
  const channel = step.targetType;
  const low = step.targetLow;
  const high = finite(step.targetHigh) ? step.targetHigh : low;
  return { channel, lower: Math.min(low, high), upper: Math.max(low, high), unit: step.targetUnit ?? CHANNELS[channel].unit };
}

function indexForDistance(projection: AnalysisProjection, start: number, metres: number): number {
  const origin = projection.streams.distance[start];
  if (!finite(origin)) return start;
  const target = origin + metres;
  for (let index = start; index < projection.streams.distance.length; index++) {
    const value = projection.streams.distance[index];
    if (finite(value) && value >= target) return index;
  }
  return projection.streams.distance.length - 1;
}

function targetCompliance(projection: AnalysisProjection, range: IndexRange, target: PlannedTarget | undefined): number | null {
  if (!target) return null;
  const values = projection.streams.channels[target.channel];
  if (!values) return null;
  let measured = 0;
  let compliant = 0;
  for (let index = range[0]; index < range[1]; index++) {
    const value = values[index];
    const seconds = projection.streams.elapsed[index + 1] - projection.streams.elapsed[index];
    if (!finite(value) || seconds <= 0 || projection.streams.breakBefore[index + 1]) continue;
    measured += seconds;
    if (value >= target.lower && value <= target.upper) compliant += seconds;
  }
  return measured ? 100 * compliant / measured : null;
}

export function plannedIntervals(projection: AnalysisProjection, workout?: WorkoutRevision): AnalysisInterval[] {
  if (!workout || !projection.streams.elapsed.length) return [];
  const steps = flattenWorkoutSteps(workout.steps).filter((step): step is Extract<WorkoutStep, { kind: "step" }> => step.kind === "step");
  const last = projection.streams.elapsed.length - 1;
  let cursor = 0;
  return steps.map((step, index) => {
    const start = cursor;
    let end = last;
    if (step.durationType === "time" && finite(step.durationValue)) {
      end = nearestIndex(projection.streams.elapsed, projection.streams.elapsed[start] + step.durationValue);
    } else if (step.durationType === "distance" && finite(step.durationValue)) {
      end = indexForDistance(projection, start, step.durationValue);
    } else {
      end = projection.laps.find(lap => lap.start > start)?.start ?? last;
    }
    end = Math.max(start, Math.min(last, end));
    cursor = Math.min(last, Math.max(end, start + 1));
    const target = targetForStep(step);
    return {
      id: `planned-${step.id}-${index}`,
      label: step.name || `${step.phase ?? "Step"} ${index + 1}`,
      source: "planned" as const,
      phase: step.phase,
      start,
      end,
      metrics: intervalMetrics(projection, [start, end]),
      target,
      compliancePercent: targetCompliance(projection, [start, end], target),
    };
  });
}

function inZone(value: number, zone: AnalysisZone): boolean {
  return (zone.lower === null || value >= zone.lower) && (zone.upper === null || value <= zone.upper);
}

export function zoneDistribution(projection: AnalysisProjection, channel: Channel, inputRange?: IndexRange | null): ZoneDistribution | null {
  const definitions = projection.zones[channel];
  const values = projection.streams.channels[channel];
  if (!definitions?.length || !values) return null;
  const range = boundedRange(projection, inputRange);
  const seconds = definitions.map(() => 0);
  let total = 0;
  let classified = 0;
  for (let index = range[0]; index < range[1]; index++) {
    const value = values[index];
    const duration = projection.streams.elapsed[index + 1] - projection.streams.elapsed[index];
    if (!finite(value) || duration <= 0 || projection.streams.breakBefore[index + 1]) continue;
    total += duration;
    const zoneIndex = definitions.findIndex(zone => inZone(value, zone));
    if (zoneIndex >= 0) {
      seconds[zoneIndex] += duration;
      classified += duration;
    }
  }
  return {
    channel,
    totalSeconds: total,
    classifiedSeconds: classified,
    unclassifiedSeconds: Math.max(0, total - classified),
    zones: definitions.map((zone, index) => ({
      ...zone,
      seconds: seconds[index],
      percentage: total ? 100 * seconds[index] / total : 0,
    })),
  };
}

export function histogram(projection: AnalysisProjection, channel: Channel, inputRange?: IndexRange | null, binCount = 12): HistogramBin[] {
  const values = projection.streams.channels[channel];
  if (!values) return [];
  const [start, end] = boundedRange(projection, inputRange);
  const selected = values.slice(start, end + 1).filter((value): value is number => finite(value));
  if (!selected.length) return [];
  const minimum = Math.min(...selected);
  const maximum = Math.max(...selected);
  const width = Math.max(Number.EPSILON, (maximum - minimum) / Math.max(1, binCount));
  const counts = Array.from({ length: binCount }, () => 0);
  for (const value of selected) counts[Math.min(binCount - 1, Math.floor((value - minimum) / width))]++;
  return counts.map((count, index) => ({
    lower: minimum + index * width,
    upper: index === binCount - 1 ? maximum : minimum + (index + 1) * width,
    count,
    percentage: 100 * count / selected.length,
  }));
}

export function scatterSamples(projection: AnalysisProjection, x: Channel, y: Channel, inputRange?: IndexRange | null, limit = 600): ScatterSample[] {
  const xValues = projection.streams.channels[x];
  const yValues = projection.streams.channels[y];
  if (!xValues || !yValues) return [];
  const [start, end] = boundedRange(projection, inputRange);
  const step = Math.max(1, Math.ceil((end - start + 1) / Math.max(1, limit)));
  const samples: ScatterSample[] = [];
  for (let index = start; index <= end; index += step) {
    const xValue = xValues[index];
    const yValue = yValues[index];
    if (finite(xValue) && finite(yValue)) samples.push({ index, x: xValue, y: yValue });
  }
  return samples;
}

export function densityHeatmap(samples: ScatterSample[], xBins = 12, yBins = 10): HeatmapCell[] {
  if (!samples.length) return [];
  const minimumX = Math.min(...samples.map(sample => sample.x));
  const maximumX = Math.max(...samples.map(sample => sample.x));
  const minimumY = Math.min(...samples.map(sample => sample.y));
  const maximumY = Math.max(...samples.map(sample => sample.y));
  const width = Math.max(Number.EPSILON, (maximumX - minimumX) / xBins);
  const height = Math.max(Number.EPSILON, (maximumY - minimumY) / yBins);
  const cells = new Map<string, HeatmapCell>();
  for (const sample of samples) {
    const xBin = Math.min(xBins - 1, Math.floor((sample.x - minimumX) / width));
    const yBin = Math.min(yBins - 1, Math.floor((sample.y - minimumY) / height));
    const key = `${xBin}:${yBin}`;
    const cell = cells.get(key) ?? {
      xBin, yBin,
      xLower: minimumX + xBin * width,
      xUpper: xBin === xBins - 1 ? maximumX : minimumX + (xBin + 1) * width,
      yLower: minimumY + yBin * height,
      yUpper: yBin === yBins - 1 ? maximumY : minimumY + (yBin + 1) * height,
      count: 0,
      indices: [],
    };
    cell.count++;
    cell.indices.push(sample.index);
    cells.set(key, cell);
  }
  return [...cells.values()].sort((a, b) => a.yBin - b.yBin || a.xBin - b.xBin);
}

function bestForDuration(projection: AnalysisProjection, seconds: number): BestEffort | null {
  const elapsed = projection.streams.elapsed;
  const distance = projection.streams.distance;
  if (!elapsed.length || !distance.some(finite) || elapsed.at(-1)! < seconds) return null;
  let best: { start: number; end: number; speed: number; distance: number; duration: number } | null = null;
  for (let start = 0; start < elapsed.length - 1; start++) {
    const end = nearestIndex(elapsed, elapsed[start] + seconds);
    if (end <= start || projection.streams.breakBefore.slice(start + 1, end + 1).some(Boolean)) continue;
    const d0 = distance[start];
    const d1 = distance[end];
    const duration = elapsed[end] - elapsed[start];
    if (!finite(d0) || !finite(d1) || duration < seconds * 0.95) continue;
    const covered = d1 - d0;
    const speed = covered / duration;
    if (covered > 0 && (!best || speed > best.speed)) best = { start, end, speed, distance: covered, duration };
  }
  return best ? effort(projection, `time-${seconds}`, `${seconds < 60 ? `${seconds} sec` : `${seconds / 60} min`}`, "duration", best) : null;
}

function bestForDistance(projection: AnalysisProjection, metres: number, label: string): BestEffort | null {
  const elapsed = projection.streams.elapsed;
  const distance = projection.streams.distance;
  if (!distance.some(finite) || (projection.summary.distance ?? 0) < metres) return null;
  let best: { start: number; end: number; speed: number; distance: number; duration: number } | null = null;
  let end = 0;
  for (let start = 0; start < distance.length - 1; start++) {
    const origin = distance[start];
    if (!finite(origin)) continue;
    end = Math.max(end, start + 1);
    while (end < distance.length && (!finite(distance[end]) || distance[end]! - origin < metres)) end++;
    if (end >= distance.length || projection.streams.breakBefore.slice(start + 1, end + 1).some(Boolean)) continue;
    const duration = elapsed[end] - elapsed[start];
    if (duration <= 0) continue;
    const covered = distance[end]! - origin;
    const speed = covered / duration;
    if (!best || duration < best.duration) best = { start, end, speed, distance: covered, duration };
  }
  return best ? effort(projection, `distance-${metres}`, label, "distance", best) : null;
}

function effort(
  projection: AnalysisProjection,
  id: string,
  label: string,
  basis: BestEffort["basis"],
  value: { start: number; end: number; speed: number; distance: number; duration: number },
): BestEffort {
  const metrics = intervalMetrics(projection, [value.start, value.end]);
  return {
    id,
    label,
    basis,
    start: value.start,
    end: value.end,
    durationSeconds: value.duration,
    distanceMeters: value.distance,
    averageSpeedMps: value.speed,
    averagePaceSecPerKm: 1000 / value.speed,
    averageHeartRateBpm: metrics.averageHeartRateBpm,
    averagePowerWatts: metrics.averagePowerWatts,
    averageCadenceSpm: metrics.averageCadenceSpm,
  };
}

export function bestEfforts(projection: AnalysisProjection): BestEffort[] {
  const byTime = [5, 10, 30, 60, 120, 300, 600, 1200].map(seconds => bestForDuration(projection, seconds));
  const byDistance = [
    [100, "100 m"], [400, "400 m"], [800, "800 m"], [1000, "1 km"],
    [1609.344, "1 mile"], [5000, "5 km"], [10000, "10 km"],
  ].map(([metres, label]) => bestForDistance(projection, metres as number, label as string));
  return [...byTime, ...byDistance].filter((item): item is BestEffort => item !== null);
}

function efficiencyRatio(projection: AnalysisProjection, range: IndexRange): number | null {
  const summary = rangeSummary(projection, range);
  const speed = summary.means.speed;
  const heartRate = summary.means.heart_rate;
  return finite(speed) && finite(heartRate) && heartRate > 0 ? speed / heartRate : null;
}

export function efficiencyAnalysis(projection: AnalysisProjection, inputRange?: IndexRange | null): EfficiencyAnalysis | null {
  if (!projection.streams.channels.heart_rate || !projection.streams.channels.speed || projection.streams.elapsed.length < 3) return null;
  const range = boundedRange(projection, inputRange);
  if (range[1] - range[0] < 2) return null;
  const midpointElapsed = (projection.streams.elapsed[range[0]] + projection.streams.elapsed[range[1]]) / 2;
  const midpoint = Math.max(range[0] + 1, Math.min(range[1] - 1, nearestIndex(projection.streams.elapsed, midpointElapsed)));
  const whole = rangeSummary(projection, range);
  const first = efficiencyRatio(projection, [range[0], midpoint]);
  const second = efficiencyRatio(projection, [midpoint, range[1]]);
  return {
    range,
    averageSpeedMps: whole.means.speed ?? null,
    averageHeartRateBpm: whole.means.heart_rate ?? null,
    speedPerHeartBeat: finite(whole.means.speed) && finite(whole.means.heart_rate) && whole.means.heart_rate > 0 ? whole.means.speed / whole.means.heart_rate : null,
    powerPerHeartBeat: finite(whole.means.power) && finite(whole.means.heart_rate) && whole.means.heart_rate > 0 ? whole.means.power / whole.means.heart_rate : null,
    firstHalfSpeedPerHeartBeat: first,
    secondHalfSpeedPerHeartBeat: second,
    aerobicDecouplingPercent: finite(first) && finite(second) && first > 0 ? 100 * (1 - second / first) : null,
  };
}

export function peakSignalEfforts(projection: AnalysisProjection): PeakSignalEffort[] {
  const windows = [30, 60, 300, 600, 1200];
  const channels: PeakSignalEffort["channel"][] = ["speed", "heart_rate", "power", "cadence"];
  const elapsed = projection.streams.elapsed;
  const breaks = projection.streams.breakBefore;
  return channels.flatMap(channel => {
    const values = projection.streams.channels[channel];
    if (!values || elapsed.length < 2) return [];
    const weighted = [0], measured = [0], discontinuities = [0];
    for (let index = 0; index < elapsed.length - 1; index++) {
      const seconds = Math.max(0, elapsed[index + 1] - elapsed[index]);
      const valid = finite(values[index]) && seconds > 0 && !breaks[index + 1];
      weighted.push(weighted.at(-1)! + (valid ? values[index]! * seconds : 0));
      measured.push(measured.at(-1)! + (valid ? seconds : 0));
      discontinuities.push(discontinuities.at(-1)! + (breaks[index + 1] ? 1 : 0));
    }
    return windows.flatMap(windowSeconds => {
      let best: PeakSignalEffort | null = null;
      for (let start = 0; start < elapsed.length - 1; start++) {
        const end = nearestIndex(elapsed, elapsed[start] + windowSeconds);
        const duration = elapsed[end] - elapsed[start];
        if (end <= start || duration < windowSeconds * .95 || discontinuities[end] - discontinuities[start] > 0) continue;
        const seconds = measured[end] - measured[start];
        if (seconds < duration * .8) continue;
        const average = (weighted[end] - weighted[start]) / seconds;
        if (!best || average > best.average) best = { id: `${channel}-${windowSeconds}`, channel, windowSeconds, start, end, average };
      }
      return best ? [best] : [];
    });
  });
}

/** Minetti-style energy-cost polynomial: converts graded speed to equivalent level-running speed. */
function gradeCost(gradePercent: number): number {
  const slope = Math.max(-.45, Math.min(.45, gradePercent / 100));
  return 155.4 * slope ** 5 - 30.4 * slope ** 4 - 43.3 * slope ** 3 + 46.3 * slope ** 2 + 19.5 * slope + 3.6;
}

export function derivedRunningMetrics(projection: AnalysisProjection, inputRange?: IndexRange | null): DerivedRunningMetrics {
  const range = boundedRange(projection, inputRange);
  const speed = projection.streams.channels.speed;
  const grade = projection.streams.channels.grade;
  const altitude = projection.streams.channels.altitude;
  let adjustedDistance = 0, adjustedSeconds = 0, gain = 0, loss = 0, uphill = 0, downhill = 0, flat = 0;
  for (let index = range[0]; index < range[1]; index++) {
    const seconds = projection.streams.elapsed[index + 1] - projection.streams.elapsed[index];
    if (seconds <= 0 || projection.streams.breakBefore[index + 1]) continue;
    const slope = grade?.[index];
    const velocity = speed?.[index];
    if (finite(slope)) {
      if (slope > 1) uphill += seconds;
      else if (slope < -1) downhill += seconds;
      else flat += seconds;
    }
    if (finite(velocity) && velocity > 0 && finite(slope)) {
      adjustedDistance += velocity * gradeCost(slope) / gradeCost(0) * seconds;
      adjustedSeconds += seconds;
    }
    const before = altitude?.[index], after = altitude?.[index + 1];
    if (finite(before) && finite(after)) {
      const delta = after - before;
      if (delta > 0) gain += delta;
      else loss -= delta;
    }
  }
  const heartRateDistribution = zoneDistribution(projection, "heart_rate", range);
  const weightedSeconds = heartRateDistribution?.zones.reduce((sum, zone, index) => sum + zone.seconds * (index + 1) ** 2, 0) ?? 0;
  const maximumWeight = heartRateDistribution?.zones.length ? heartRateDistribution.zones.length ** 2 : 0;
  return {
    range,
    gradeAdjustedPaceSecPerKm: adjustedDistance > 0 ? 1000 * adjustedSeconds / adjustedDistance : null,
    elevationGainMeters: gain,
    elevationLossMeters: loss,
    uphillSeconds: uphill,
    downhillSeconds: downhill,
    flatSeconds: flat,
    internalLoadScore: maximumWeight ? 100 * weightedSeconds / (3600 * maximumWeight) : null,
    loadFormula: "100 × Σ(zone seconds × zone number²) ÷ (3600 × highest zone number²)",
  };
}

export function buildActivityIntelligence(projection: AnalysisProjection, workout?: WorkoutRevision): ActivityIntelligence {
  const planned = plannedIntervals(projection, workout);
  const measurable = planned.filter(interval => interval.compliancePercent !== null && interval.compliancePercent !== undefined);
  const compliant = measurable.filter(interval => interval.compliancePercent! >= 80);
  const distributions = (Object.keys(projection.zones) as Channel[])
    .map(channel => zoneDistribution(projection, channel))
    .filter((item): item is ZoneDistribution => item !== null);
  return {
    version: INTELLIGENCE_VERSION,
    intervals: [...recordedIntervals(projection), ...detectEffortIntervals(projection), ...planned],
    zoneDistributions: distributions,
    bestEfforts: bestEfforts(projection),
    peakSignals: peakSignalEfforts(projection),
    efficiency: efficiencyAnalysis(projection),
    derivedRunning: derivedRunningMetrics(projection),
    ...(workout ? { plannedActual: {
      workoutId: workout.workoutId,
      workoutVersion: workout.version,
      workoutName: workout.name,
      stepCount: planned.length,
      measuredStepCount: measurable.length,
      compliantStepCount: compliant.length,
      compliancePercent: measurable.length ? measurable.reduce((sum, interval) => sum + interval.compliancePercent!, 0) / measurable.length : null,
    } } : {}),
    algorithms: {
      intervals: "recorded-plus-speed-q72-v1",
      plannedActual: "sequential-duration-distance-alignment-v1",
      zones: "time-weighted-configured-bounds-v1",
      bestEfforts: "rolling-time-and-distance-v1",
      peakSignals: "time-weighted-rolling-mean-v1",
      efficiency: "speed-per-heart-beat-halves-v1",
      gradeAdjustedPace: "minetti-cost-polynomial-v1",
      internalLoad: "zone-duration-squared-v1",
    },
  };
}
