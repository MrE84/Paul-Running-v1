import { buildActivityIntelligence, type ActivityIntelligence, type BestEffort } from "./intelligence";
import type { AnalysisProjection } from "./projection";

export const TRENDS_VERSION = "1.0.0";

export interface TrendActivity {
  projection: AnalysisProjection;
  equipment?: string[];
}

export interface TrendOptions {
  from?: string;
  to?: string;
  sport?: string;
  bucket?: "week" | "month";
  fitnessTimeConstantDays?: number;
  fatigueTimeConstantDays?: number;
}

export interface VolumeBucket {
  start: string;
  label: string;
  activities: number;
  distanceMeters: number;
  durationSeconds: number;
  elevationGainMeters: number;
  internalLoad: number;
  heartRateZones: Array<{ name: string; color: string; seconds: number }>;
}

export interface LoadPoint {
  date: string;
  load: number;
  fitness: number;
  fatigue: number;
  form: number;
}

export interface EfficiencyPoint {
  activityId: string;
  date: string;
  title: string;
  speedPerHeartBeat: number | null;
  easyPaceSecPerKm: number | null;
  thresholdPaceSecPerKm: number | null;
  thresholdHeartRateBpm: number | null;
  aerobicDecouplingPercent: number | null;
}

export interface PersonalBestPoint {
  activityId: string;
  date: string;
  distanceMeters: number;
  label: string;
  durationSeconds: number;
  previousBestSeconds: number | null;
  improvementSeconds: number | null;
}

export interface AthleteTrends {
  version: string;
  generatedAt: string;
  filters: Required<Pick<TrendOptions, "bucket" | "fitnessTimeConstantDays" | "fatigueTimeConstantDays">> & Pick<TrendOptions, "from" | "to" | "sport">;
  totals: { activities: number; distanceMeters: number; durationSeconds: number; elevationGainMeters: number; internalLoad: number };
  volume: VolumeBucket[];
  load: LoadPoint[];
  efficiency: EfficiencyPoint[];
  personalBests: PersonalBestPoint[];
  equipment: Array<{ name: string; distanceMeters: number; activities: number }>;
  quality: { processedActivities: number; skippedActivities: Array<{ activityId: string; message: string }> };
  fitnessAnswer: { direction: "improving" | "stable" | "declining" | "insufficient_data"; efficiencyChangePercent: number | null; message: string };
  algorithms: Record<string, string>;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isoDay(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function bucketStart(value: string, bucket: "week" | "month"): string {
  const date = new Date(value);
  if (bucket === "month") return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function intelligenceFor(projection: AnalysisProjection): ActivityIntelligence {
  return projection.intelligence ?? buildActivityIntelligence(projection);
}

function activityLoad(projection: AnalysisProjection, intelligence: ActivityIntelligence): number {
  const calculated = intelligence.derivedRunning.internalLoadScore;
  if (finite(calculated)) return calculated;
  // Explicit fallback when zones are unavailable: 50 load points per moving hour.
  return Math.max(0, projection.summary.duration ?? projection.summary.elapsed ?? 0) / 3600 * 50;
}

function easyPace(projection: AnalysisProjection): number | null {
  const heartRate = projection.streams.channels.heart_rate;
  const speed = projection.streams.channels.speed;
  const zones = projection.zones.heart_rate;
  if (!heartRate || !speed || !zones?.length) return null;
  const easy = zones.find(zone => /easy|recovery|endurance|z1|z2/i.test(zone.name)) ?? zones[Math.min(1, zones.length - 1)];
  let distance = 0;
  let seconds = 0;
  for (let index = 0; index < projection.streams.elapsed.length - 1; index++) {
    const hr = heartRate[index];
    const velocity = speed[index];
    const duration = projection.streams.elapsed[index + 1] - projection.streams.elapsed[index];
    if (!finite(hr) || !finite(velocity) || velocity <= 0 || duration <= 0 || projection.streams.breakBefore[index + 1]) continue;
    if ((easy.lower === null || hr >= easy.lower) && (easy.upper === null || hr <= easy.upper)) {
      seconds += duration;
      distance += velocity * duration;
    }
  }
  return distance > 0 && seconds >= 60 ? 1000 * seconds / distance : null;
}

function thresholdInterval(intelligence: ActivityIntelligence) {
  return intelligence.intervals
    .filter(interval => interval.metrics.durationSeconds >= 300 && interval.metrics.durationSeconds <= 3600)
    .sort((a, b) => {
      const aNamed = /threshold|tempo|active|work/i.test(`${a.label} ${a.phase ?? ""}`) ? 1 : 0;
      const bNamed = /threshold|tempo|active|work/i.test(`${b.label} ${b.phase ?? ""}`) ? 1 : 0;
      return bNamed - aNamed || b.metrics.durationSeconds - a.metrics.durationSeconds;
    })[0];
}

function distanceFromEffort(effort: BestEffort): number | null {
  if (effort.basis !== "distance") return null;
  const parsed = Number(effort.id.replace("distance-", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function fitnessAnswer(points: EfficiencyPoint[]): AthleteTrends["fitnessAnswer"] {
  const values = points.map(point => point.speedPerHeartBeat).filter(finite);
  if (values.length < 4) return { direction: "insufficient_data", efficiencyChangePercent: null, message: "At least four activities with overlapping speed and heart-rate data are needed." };
  const split = Math.floor(values.length / 2);
  const earlier = values.slice(0, split).reduce((sum, value) => sum + value, 0) / split;
  const laterValues = values.slice(split);
  const later = laterValues.reduce((sum, value) => sum + value, 0) / laterValues.length;
  const change = earlier > 0 ? 100 * (later / earlier - 1) : 0;
  const direction = change > 2 ? "improving" : change < -2 ? "declining" : "stable";
  return {
    direction,
    efficiencyChangePercent: change,
    message: direction === "improving"
      ? `Recent pace-to-HR efficiency is ${change.toFixed(1)}% higher than the earlier half of this window.`
      : direction === "declining"
        ? `Recent pace-to-HR efficiency is ${Math.abs(change).toFixed(1)}% lower than the earlier half of this window.`
        : `Pace-to-HR efficiency is broadly stable (${change >= 0 ? "+" : ""}${change.toFixed(1)}%).`,
  };
}

/** Deterministic athlete-history projection; source activity projections remain immutable. */
export function buildAthleteTrends(input: TrendActivity[], options: TrendOptions = {}): AthleteTrends {
  const bucket = options.bucket ?? "week";
  const fitnessDays = Math.max(2, Math.min(120, options.fitnessTimeConstantDays ?? 42));
  const fatigueDays = Math.max(1, Math.min(60, options.fatigueTimeConstantDays ?? 7));
  const selected = input.filter(({ projection }) => {
    const date = projection.activity.startedAt;
    return Boolean(date)
      && (!options.from || date! >= options.from)
      && (!options.to || date! <= options.to)
      && (!options.sport || options.sport === "all" || projection.activity.sport === options.sport);
  }).sort((a, b) => a.projection.activity.startedAt!.localeCompare(b.projection.activity.startedAt!));
  const buckets = new Map<string, VolumeBucket>();
  const loads = new Map<string, number>();
  const efficiency: EfficiencyPoint[] = [];
  const equipment = new Map<string, { name: string; distanceMeters: number; activities: number }>();
  const personalBests: PersonalBestPoint[] = [];
  const records = new Map<number, number>();

  for (const item of selected) {
    const projection = item.projection;
    const intelligence = intelligenceFor(projection);
    const startedAt = projection.activity.startedAt!;
    const day = isoDay(startedAt);
    const load = activityLoad(projection, intelligence);
    loads.set(day, (loads.get(day) ?? 0) + load);
    const start = bucketStart(startedAt, bucket);
    const entry = buckets.get(start) ?? { start, label: start, activities: 0, distanceMeters: 0, durationSeconds: 0, elevationGainMeters: 0, internalLoad: 0, heartRateZones: [] };
    entry.activities++;
    entry.distanceMeters += projection.summary.distance ?? 0;
    entry.durationSeconds += projection.summary.duration ?? projection.summary.elapsed ?? 0;
    entry.elevationGainMeters += projection.summary.ascent ?? intelligence.derivedRunning.elevationGainMeters ?? 0;
    entry.internalLoad += load;
    const zones = intelligence.zoneDistributions.find(distribution => distribution.channel === "heart_rate")?.zones ?? [];
    for (const zone of zones) {
      const existing = entry.heartRateZones.find(value => value.name === zone.name);
      if (existing) existing.seconds += zone.seconds;
      else entry.heartRateZones.push({ name: zone.name, color: zone.color, seconds: zone.seconds });
    }
    buckets.set(start, entry);
    const threshold = thresholdInterval(intelligence);
    efficiency.push({
      activityId: projection.activity.id,
      date: day,
      title: projection.activity.title,
      speedPerHeartBeat: intelligence.efficiency?.speedPerHeartBeat ?? null,
      easyPaceSecPerKm: easyPace(projection),
      thresholdPaceSecPerKm: threshold?.metrics.averagePaceSecPerKm ?? null,
      thresholdHeartRateBpm: threshold?.metrics.averageHeartRateBpm ?? null,
      aerobicDecouplingPercent: intelligence.efficiency?.aerobicDecouplingPercent ?? null,
    });
    for (const effort of intelligence.bestEfforts) {
      const distance = distanceFromEffort(effort);
      if (!finite(distance) || !finite(effort.durationSeconds)) continue;
      const previous = records.get(distance);
      if (previous === undefined || effort.durationSeconds < previous) {
        personalBests.push({ activityId: projection.activity.id, date: day, distanceMeters: distance, label: effort.label, durationSeconds: effort.durationSeconds, previousBestSeconds: previous ?? null, improvementSeconds: previous === undefined ? null : previous - effort.durationSeconds });
        records.set(distance, effort.durationSeconds);
      }
    }
    for (const name of [...new Set(item.equipment ?? [])]) {
      const value = equipment.get(name) ?? { name, distanceMeters: 0, activities: 0 };
      value.distanceMeters += projection.summary.distance ?? 0;
      value.activities++;
      equipment.set(name, value);
    }
  }

  const load: LoadPoint[] = [];
  if (selected.length) {
    const cursor = new Date(`${isoDay(selected[0].projection.activity.startedAt!)}T00:00:00.000Z`);
    const last = new Date(`${isoDay(selected.at(-1)!.projection.activity.startedAt!)}T00:00:00.000Z`);
    let fitness = 0;
    let fatigue = 0;
    const fitnessAlpha = 1 - Math.exp(-1 / fitnessDays);
    const fatigueAlpha = 1 - Math.exp(-1 / fatigueDays);
    while (cursor <= last) {
      const date = cursor.toISOString().slice(0, 10);
      const impulse = loads.get(date) ?? 0;
      fitness += fitnessAlpha * (impulse - fitness);
      fatigue += fatigueAlpha * (impulse - fatigue);
      load.push({ date, load: impulse, fitness, fatigue, form: fitness - fatigue });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  const volume = [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start));
  const totals = volume.reduce((result, value) => ({
    activities: result.activities + value.activities,
    distanceMeters: result.distanceMeters + value.distanceMeters,
    durationSeconds: result.durationSeconds + value.durationSeconds,
    elevationGainMeters: result.elevationGainMeters + value.elevationGainMeters,
    internalLoad: result.internalLoad + value.internalLoad,
  }), { activities: 0, distanceMeters: 0, durationSeconds: 0, elevationGainMeters: 0, internalLoad: 0 });
  return {
    version: TRENDS_VERSION,
    generatedAt: new Date(Math.max(0, ...selected.map(item => Date.parse(item.projection.activity.startedAt!)))).toISOString(),
    filters: { bucket, fitnessTimeConstantDays: fitnessDays, fatigueTimeConstantDays: fatigueDays, from: options.from, to: options.to, sport: options.sport },
    totals,
    volume,
    load,
    efficiency,
    personalBests,
    equipment: [...equipment.values()].sort((a, b) => b.distanceMeters - a.distanceMeters || a.name.localeCompare(b.name)),
    quality: { processedActivities: selected.length, skippedActivities: [] },
    fitnessAnswer: fitnessAnswer(efficiency),
    algorithms: {
      internalLoad: "configured-zone-duration-squared-v1; fallback-50-points-per-hour-v1",
      fitnessFatigueForm: `daily-exponential-response-v1; fitness=${fitnessDays}d; fatigue=${fatigueDays}d; form=fitness-fatigue`,
      efficiency: "speed-per-heart-beat-v1",
      easyPace: "time-weighted-speed-inside-configured-easy-zone-v1",
      threshold: "named-or-longest-5-to-60-minute-interval-v1",
      personalBests: "chronological-distance-best-progression-v1",
    },
  };
}
