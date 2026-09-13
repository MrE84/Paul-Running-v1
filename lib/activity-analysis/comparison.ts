import { buildActivityIntelligence, derivedRunningMetrics, efficiencyAnalysis, intervalMetrics, zoneDistribution, type AnalysisInterval } from "./intelligence";
import { CHANNELS, type AnalysisProjection, type Channel, type IndexRange } from "./projection";

export const COMPARISON_VERSION = "1.0.0";

export type ComparisonAlignment = "time" | "distance" | "interval";

export interface ComparisonOptions {
  alignment: ComparisonAlignment;
  channels: Channel[];
  intervalLabel?: string;
  shifts?: Record<string, number>;
  relative?: boolean;
  maxPoints?: number;
}

export interface ComparisonPoint {
  x: number;
  index: number;
  values: Partial<Record<Channel, number | null>>;
}

export interface ComparisonSummary {
  activityId: string;
  title: string;
  sport: string;
  startedAt: string | null;
  range: IndexRange;
  intervalLabel?: string;
  durationSeconds: number;
  distanceMeters: number | null;
  averagePaceSecPerKm: number | null;
  averageHeartRateBpm: number | null;
  averageCadenceSpm: number | null;
  averagePowerWatts: number | null;
  elevationGainMeters: number | null;
  internalLoadScore: number | null;
  heartRateZones: Array<{ name: string; seconds: number; percentage: number; color: string }>;
  aerobicDecouplingPercent: number | null;
  speedPerHeartBeat: number | null;
  best5kSeconds: number | null;
}

export interface ComparisonSeries {
  activityId: string;
  title: string;
  color: string;
  shift: number;
  range: IndexRange;
  points: ComparisonPoint[];
  warning?: string;
}

export interface ActivityComparison {
  version: string;
  alignment: ComparisonAlignment;
  xUnit: "seconds" | "meters";
  relative: boolean;
  baselineActivityId: string;
  channels: Channel[];
  domain: [number, number];
  series: ComparisonSeries[];
  summaries: ComparisonSummary[];
  algorithms: Record<string, string>;
}

const COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb7185"];

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function intelligenceFor(projection: AnalysisProjection) {
  return projection.intelligence ?? buildActivityIntelligence(projection);
}

function normalizedLabel(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function matchedInterval(projection: AnalysisProjection, requested?: string): AnalysisInterval | undefined {
  const intervals = intelligenceFor(projection).intervals;
  const needle = normalizedLabel(requested);
  if (needle) {
    return intervals.find(item => normalizedLabel(item.label) === needle)
      ?? intervals.find(item => normalizedLabel(item.phase) === needle)
      ?? intervals.find(item => normalizedLabel(item.label).includes(needle));
  }
  return intervals.find(item => item.source === "planned" && item.phase === "active")
    ?? intervals.find(item => item.source === "detected")
    ?? intervals.find(item => item.source === "recorded");
}

function boundedRange(projection: AnalysisProjection, range?: IndexRange): IndexRange {
  const last = Math.max(0, projection.streams.elapsed.length - 1);
  return [
    Math.max(0, Math.min(last, range?.[0] ?? 0)),
    Math.max(0, Math.min(last, range?.[1] ?? last)),
  ].sort((a, b) => a - b) as IndexRange;
}

function comparisonRange(projection: AnalysisProjection, options: ComparisonOptions) {
  if (options.alignment !== "interval") return { range: boundedRange(projection) };
  const interval = matchedInterval(projection, options.intervalLabel);
  return interval
    ? { range: boundedRange(projection, [interval.start, interval.end]), interval }
    : { range: boundedRange(projection), warning: options.intervalLabel
      ? `No interval matched “${options.intervalLabel}”; the complete activity is shown.`
      : "No comparable interval was detected; the complete activity is shown." };
}

function sourceX(projection: AnalysisProjection, index: number, start: number, alignment: ComparisonAlignment): number | null {
  if (alignment === "distance") {
    const current = projection.streams.distance[index];
    const origin = projection.streams.distance[start];
    return finite(current) && finite(origin) ? current - origin : null;
  }
  return projection.streams.elapsed[index] - projection.streams.elapsed[start];
}

/** Peak-preserving comparison reduction. Source indices remain attached to every point. */
function sampledIndices(projection: AnalysisProjection, range: IndexRange, channels: Channel[], maxPoints: number): number[] {
  const count = range[1] - range[0] + 1;
  if (count <= maxPoints) return Array.from({ length: count }, (_, offset) => range[0] + offset);
  const selected = new Set<number>([range[0], range[1]]);
  const bucketSize = Math.max(1, Math.ceil(count / Math.max(2, maxPoints / Math.max(2, channels.length * 2))));
  for (let start = range[0]; start <= range[1]; start += bucketSize) {
    const end = Math.min(range[1] + 1, start + bucketSize);
    selected.add(start);
    selected.add(end - 1);
    for (const channel of channels) {
      const values = projection.streams.channels[channel];
      if (!values) continue;
      let minimum: number | null = null;
      let maximum: number | null = null;
      for (let index = start; index < end; index++) {
        if (!finite(values[index])) continue;
        if (minimum === null || values[index]! < values[minimum]!) minimum = index;
        if (maximum === null || values[index]! > values[maximum]!) maximum = index;
      }
      if (minimum !== null) selected.add(minimum);
      if (maximum !== null) selected.add(maximum);
    }
  }
  return [...selected].sort((a, b) => a - b);
}

function interpolate(points: ComparisonPoint[], channel: Channel, x: number): number | null {
  if (!points.length || x < points[0].x || x > points.at(-1)!.x) return null;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle].x < x) low = middle + 1;
    else high = middle;
  }
  const after = points[low];
  const before = points[Math.max(0, low - 1)];
  const a = before.values[channel];
  const b = after.values[channel];
  if (!finite(a) || !finite(b)) return finite(b) ? b : finite(a) ? a : null;
  if (after.x === before.x) return b;
  const fraction = (x - before.x) / (after.x - before.x);
  return a + (b - a) * fraction;
}

function summary(projection: AnalysisProjection, range: IndexRange, interval?: AnalysisInterval): ComparisonSummary {
  const intelligence = intelligenceFor(projection);
  const metrics = intervalMetrics(projection, range);
  const efficiency = efficiencyAnalysis(projection, range);
  const derived = derivedRunningMetrics(projection, range);
  const heartRateZones = zoneDistribution(projection, "heart_rate", range)?.zones.filter(zone => zone.seconds > 0) ?? [];
  const best5k = intelligence.bestEfforts.find(effort => effort.id === "distance-5000");
  return {
    activityId: projection.activity.id,
    title: projection.activity.title,
    sport: projection.activity.sport,
    startedAt: projection.activity.startedAt,
    range,
    ...(interval ? { intervalLabel: interval.label } : {}),
    durationSeconds: metrics.durationSeconds,
    distanceMeters: metrics.distanceMeters,
    averagePaceSecPerKm: metrics.averagePaceSecPerKm,
    averageHeartRateBpm: metrics.averageHeartRateBpm,
    averageCadenceSpm: metrics.averageCadenceSpm,
    averagePowerWatts: metrics.averagePowerWatts,
    elevationGainMeters: metrics.elevationGainMeters,
    internalLoadScore: derived.internalLoadScore,
    heartRateZones,
    aerobicDecouplingPercent: efficiency?.aerobicDecouplingPercent ?? null,
    speedPerHeartBeat: efficiency?.speedPerHeartBeat ?? null,
    best5kSeconds: best5k?.durationSeconds ?? null,
  };
}

export function availableComparisonIntervals(projections: AnalysisProjection[]): string[] {
  const counts = new Map<string, { label: string; activities: Set<string> }>();
  for (const projection of projections) {
    for (const interval of intelligenceFor(projection).intervals) {
      const key = normalizedLabel(interval.label || interval.phase);
      if (!key) continue;
      const entry = counts.get(key) ?? { label: interval.label, activities: new Set<string>() };
      entry.activities.add(projection.activity.id);
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.activities.size - a.activities.size || a.label.localeCompare(b.label))
    .map(entry => entry.label);
}

/** Pure, deterministic comparison projection. It never edits any source activity projection. */
export function buildActivityComparison(projections: AnalysisProjection[], input: ComparisonOptions): ActivityComparison {
  if (projections.length < 2 || projections.length > 6) throw new Error("Select between 2 and 6 activities to compare.");
  const seen = new Set<string>();
  for (const projection of projections) {
    if (seen.has(projection.activity.id)) throw new Error("Each comparison activity must be unique.");
    seen.add(projection.activity.id);
  }
  const channels = [...new Set(input.channels)].filter(channel => channel in CHANNELS).slice(0, 5);
  if (!channels.length) throw new Error("Choose at least one comparison channel.");
  const maxPoints = Math.max(200, Math.min(5000, input.maxPoints ?? 1800));
  const ranges = projections.map(projection => comparisonRange(projection, input));
  const absoluteSeries: ComparisonSeries[] = projections.map((projection, seriesIndex) => {
    const selected = ranges[seriesIndex];
    const shift = finite(input.shifts?.[projection.activity.id]) ? input.shifts![projection.activity.id] : 0;
    const points = sampledIndices(projection, selected.range, channels, maxPoints).flatMap(index => {
      const x = sourceX(projection, index, selected.range[0], input.alignment);
      if (!finite(x)) return [];
      const values: ComparisonPoint["values"] = {};
      for (const channel of channels) values[channel] = projection.streams.channels[channel]?.[index] ?? null;
      return [{ x: x + shift, index, values }];
    });
    return {
      activityId: projection.activity.id,
      title: projection.activity.title,
      color: COLORS[seriesIndex % COLORS.length],
      shift,
      range: selected.range,
      points,
      ...(selected.warning ? { warning: selected.warning } : {}),
    };
  });
  const baseline = absoluteSeries[0];
  const series = input.relative ? absoluteSeries.map(item => ({
    ...item,
    points: item.points.map(point => ({
      ...point,
      values: Object.fromEntries(channels.map(channel => {
        const value = point.values[channel];
        const reference = interpolate(baseline.points, channel, point.x);
        return [channel, finite(value) && finite(reference) ? value - reference : null];
      })) as Partial<Record<Channel, number | null>>,
    })),
  })) : absoluteSeries;
  const minima = series.flatMap(item => item.points.length ? [item.points[0].x] : []);
  const maxima = series.flatMap(item => item.points.length ? [item.points.at(-1)!.x] : []);
  const overlap: [number, number] = [Math.max(...minima), Math.min(...maxima)];
  const domain: [number, number] = minima.length && overlap[1] > overlap[0]
    ? overlap
    : [minima.length ? Math.min(...minima) : 0, maxima.length ? Math.max(...maxima) : 1];
  return {
    version: COMPARISON_VERSION,
    alignment: input.alignment,
    xUnit: input.alignment === "distance" ? "meters" : "seconds",
    relative: Boolean(input.relative),
    baselineActivityId: projections[0].activity.id,
    channels,
    domain,
    series,
    summaries: projections.map((projection, index) => summary(projection, ranges[index].range, ranges[index].interval)),
    algorithms: {
      alignment: input.alignment === "distance" ? "relative-recorded-distance-v1" : input.alignment === "interval" ? "matched-interval-start-v1" : "relative-elapsed-time-v1",
      reduction: "multi-channel-min-max-buckets-v1",
      relative: "linear-interpolation-to-first-activity-v1",
    },
  };
}
