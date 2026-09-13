import type { Activity, ZoneSet } from "../domain/contracts";
import type { ActivitySource, DecodedFit } from "./contracts";
import type { ActivityIntelligence } from "./intelligence";
import type { WeatherEnrichment } from "./weather";
import { analyseDecodedFit, firstNumber, normaliseDate, safeNumber, semicirclesToDegrees } from "./core";

export const PROJECTION_VERSION = "1.2.0";
export const CHANNELS = {
  heart_rate: { label: "Heart rate", unit: "bpm", color: "#fb7185" },
  pace: { label: "Pace", unit: "min/km", color: "#60a5fa" },
  cadence: { label: "Cadence", unit: "spm", color: "#fbbf24" },
  altitude: { label: "Elevation", unit: "m", color: "#6ee7b7" },
  power: { label: "Power", unit: "W", color: "#c4b5fd" },
  speed: { label: "Speed", unit: "m/s", color: "#38bdf8" },
  grade: { label: "Gradient", unit: "%", color: "#2dd4bf" },
  temperature: { label: "Device temperature", unit: "°C", color: "#fdba74" },
  vertical_oscillation: { label: "Vertical oscillation", unit: "mm", color: "#f0abfc" },
  ground_contact_time: { label: "Ground contact", unit: "ms", color: "#a5b4fc" },
  respiration_rate: { label: "Respiration", unit: "/min", color: "#67e8f9" },
  ambient_temperature: { label: "Ambient temperature", unit: "°C", color: "#fb923c" },
  humidity: { label: "Humidity", unit: "%", color: "#22d3ee" },
  wind_speed: { label: "Wind speed", unit: "m/s", color: "#a7f3d0" },
  headwind: { label: "Headwind", unit: "m/s", color: "#fda4af" },
  precipitation: { label: "Precipitation", unit: "mm", color: "#7dd3fc" },
} as const;
export type Channel = keyof typeof CHANNELS;
export type Values = Array<number | null>;
export type IndexRange = [number, number];
export type Axis = "time" | "distance";
export interface AnalysisLap {
  id: string; label: string; start: number; end: number;
  duration: number | null; distance: number | null; heartRate: number | null;
}
export interface AnalysisZone {
  name: string; lower: number | null; upper: number | null; color: string;
}
export interface ActivityListItem {
  id: string; title: string; sport: string; startedAt: string | null;
  distance: number | null; duration: number | null; calendarItemId?: string;
}
export interface AnalysisProjection {
  version: string;
  source: Pick<ActivitySource, "id" | "name" | "origin">;
  activity: ActivityListItem;
  summary: {
    distance: number | null; duration: number | null; elapsed: number | null;
    speed: number | null; heartRate: number | null; cadence: number | null;
    ascent: number | null; calories: number | null;
  };
  streams: {
    elapsed: number[]; distance: Values; latitude: Values; longitude: Values;
    /** Original record index, for raw-data inspection after ordering/deduplication. */
    recordIndex: number[]; breakBefore: boolean[];
    channels: Partial<Record<Channel, Values>>;
  };
  laps: AnalysisLap[];
  zones: Partial<Record<Channel, AnalysisZone[]>>;
  provenance: { sourceFields: string[]; algorithms: Record<string, string> };
  quality: { flags: string[]; inputRecords: number; samples: number; missing: Partial<Record<Channel, number>> };
  intelligence?: ActivityIntelligence;
  weather?: WeatherEnrichment;
  /** Future enrichment results are independently versioned; absent != zero. */
  derived: Record<"intervals" | "zones" | "weather" | "bestEfforts" | "efficiency" | "plannedActual", { version: string; status: "pending" | "available"; sourceChannels: Channel[] }>;
}

const round = (n: number | null, precision = 3) => n === null ? null : Math.round(n * 10 ** precision) / 10 ** precision;
const positive = (n: number | null) => n !== null && n > 0 ? n : null;
const nonnegative = (n: number | null) => n !== null && n >= 0 ? n : null;
const zoneColors = ["#94a3b8", "#60a5fa", "#4ade80", "#fbbf24", "#fb7185", "#c4b5fd"];

export function activityListItem(item: Omit<Activity, "normalizedData">): ActivityListItem {
  return {
    id: item.id,
    title: typeof item.sourceMetadata.name === "string" ? item.sourceMetadata.name : item.sourceFileName?.replace(/\.fit$/i, "") || `${item.sport} activity`,
    sport: item.sport, startedAt: item.startedAt,
    distance: item.summary.distanceMeters ?? null, duration: item.summary.durationSeconds ?? null,
    ...(item.calendarItemId ? { calendarItemId: item.calendarItemId } : {}),
  };
}

function projectZones(zoneSets: ZoneSet[], sport: string, startedAt: string | null): AnalysisProjection["zones"] {
  const zones: AnalysisProjection["zones"] = {};
  if (!startedAt) return zones;
  const valid = zoneSets.filter(z => z.sport === sport && z.effectiveFrom <= startedAt && (!z.effectiveTo || z.effectiveTo > startedAt))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  for (const set of valid) {
    const key = set.targetType as Channel;
    if (!(key in CHANNELS) || zones[key]) continue;
    const expected = key === "pace" ? ["s/km", "sec/km", "seconds_per_km"] : key === "heart_rate" ? ["bpm"] : key === "power" ? ["w", "watts"] : ["spm", "rpm"];
    zones[key] = set.zones.filter(z => expected.includes(z.unit.toLowerCase())).map((z, i) => ({
      name: z.name, lower: safeNumber(z.lowerBound), upper: safeNumber(z.upperBound), color: zoneColors[i % zoneColors.length],
    }));
  }
  return zones;
}

/** Pure projection. SI units, seconds/km for pace, null for missing; never alters FIT input. */
export function projectActivity(source: ActivitySource, decoded: DecodedFit, context?: ActivityListItem, zoneSets: ZoneSet[] = []): AnalysisProjection {
  const analysed = analyseDecodedFit(source, decoded);
  const { records, summary, laps } = analysed;
  const session = summary.session;
  const startedAt = context?.startedAt ?? normaliseDate(summary.start)?.toISOString() ?? normaliseDate(records[0]?.timestamp)?.toISOString() ?? null;
  const firstTime = normaliseDate(records.find(r => normaliseDate(r.timestamp))?.timestamp)?.getTime();
  const flags = new Set<string>();
  const ordered = records.map((r, index) => {
    const timestamp = normaliseDate(r.timestamp)?.getTime();
    const seconds = firstNumber(r.elapsed_time, timestamp !== undefined && firstTime !== undefined ? (timestamp - firstTime) / 1000 : null, r.timer_time);
    if (seconds === null) flags.add("Sample timing unavailable; record order used as seconds.");
    return { r, index, seconds: Math.max(0, seconds ?? index) };
  }).sort((a, b) => a.seconds - b.seconds || a.index - b.index);
  const rows = ordered.filter((r, i) => i === ordered.length - 1 || r.seconds !== ordered[i + 1].seconds);
  if (rows.length !== records.length) flags.add("Duplicate timestamps merged; original messages retained in Raw data.");
  if (ordered.some((r, i) => i > 0 && r.index < ordered[i - 1].index)) flags.add("Out-of-order samples sorted by elapsed time.");
  const elapsed: number[] = [], distance: Values = [], latitude: Values = [], longitude: Values = [], breakBefore: boolean[] = [];
  const channels = {} as Record<Channel, Values>;
  for (const key of Object.keys(CHANNELS) as Channel[]) channels[key] = [];
  let lastDistance = 0;
  rows.forEach(({ r, seconds }, i) => {
    elapsed.push(round(seconds)!);
    let d = nonnegative(safeNumber(r.distance));
    if (d !== null && d < lastDistance) { d = null; flags.add("Distance resets excluded from distance alignment."); }
    if (d !== null) lastDistance = d;
    distance.push(round(d));
    const lat = semicirclesToDegrees(firstNumber(r.position_lat, r.latitude));
    const lon = semicirclesToDegrees(firstNumber(r.position_long, r.longitude));
    const validGps = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    latitude.push(validGps ? round(lat, 6) : null);
    longitude.push(validGps ? round(lon, 6) : null);
    const gap = i > 0 && seconds - rows[i - 1].seconds > 30;
    breakBefore.push(gap);
    if (gap) flags.add("Recording gaps over 30 seconds are not interpolated.");
    const speed = nonnegative(firstNumber(r.enhanced_speed, r.speed));
    const cadence = nonnegative(firstNumber(r.cadence, r.running_cadence));
    const values: Record<Channel, number | null> = {
      speed, pace: speed !== null && speed > 0 ? 1000 / speed : null,
      heart_rate: positive(safeNumber(r.heart_rate)),
      cadence: cadence !== null ? cadence * (String(session.sport ?? context?.sport) === "running" ? 2 : 1) : null,
      altitude: firstNumber(r.enhanced_altitude, r.altitude),
      power: nonnegative(safeNumber(r.power)), temperature: safeNumber(r.temperature), grade: safeNumber(r.grade),
      vertical_oscillation: nonnegative(safeNumber(r.vertical_oscillation)),
      ground_contact_time: nonnegative(firstNumber(r.ground_contact_time, r.stance_time)),
      respiration_rate: positive(safeNumber(r.respiration_rate)),
      ambient_temperature: null,
      humidity: null,
      wind_speed: null,
      headwind: null,
      precipitation: null,
    };
    for (const key of Object.keys(CHANNELS) as Channel[]) channels[key].push(round(values[key]));
  });
  // Distance-based elevation gradient over >=10m avoids amplifying one-second GPS noise.
  let anchor = 0;
  let derivedGrade = false;
  for (let i = 1; i < rows.length; i++) {
    if (breakBefore[i]) anchor = i;
    const d = distance[i], d0 = distance[anchor], h = channels.altitude[i], h0 = channels.altitude[anchor];
    if (d !== null && d0 !== null && d - d0 >= 10) {
      if (channels.grade[i] === null && h !== null && h0 !== null) { channels.grade[i] = round(100 * (h - h0) / (d - d0)); derivedGrade = true; }
      anchor = i;
    }
  }
  const missing: AnalysisProjection["quality"]["missing"] = {};
  const available: Partial<Record<Channel, Values>> = {};
  for (const key of Object.keys(CHANNELS) as Channel[]) {
    const count = channels[key].filter(v => v === null).length;
    if (count < rows.length) { available[key] = channels[key]; missing[key] = count; }
  }
  if (!latitude.some(v => v !== null)) flags.add("No GPS recorded; indoor analysis is available.");
  if (!distance.some(v => v !== null)) flags.add("No recorded distance; use the time axis.");
  if (!rows.length) flags.add("No sample streams recorded.");
  const activity: ActivityListItem = context ?? {
    id: source.id, title: String(session.sport_profile_name || source.name.replace(/\.fit$/i, "")), sport: String(session.sport || "other"), startedAt,
    distance: summary.distance, duration: summary.timerTime,
  };
  let lapElapsed = 0;
  const projectedLaps = laps.map((lap, i): AnalysisLap => {
    const startTime = normaliseDate(lap.start_time)?.getTime();
    const startSeconds = startTime !== undefined && firstTime !== undefined ? (startTime - firstTime) / 1000 : lapElapsed;
    const duration = firstNumber(lap.total_elapsed_time, lap.total_timer_time);
    lapElapsed = startSeconds + (duration ?? 0);
    return { id: `lap-${i + 1}`, label: `Lap ${i + 1}`, start: nearestIndex(elapsed, startSeconds), end: nearestIndex(elapsed, lapElapsed), duration,
      distance: safeNumber(lap.total_distance), heartRate: safeNumber(lap.avg_heart_rate) };
  });
  const zones = projectZones(zoneSets, activity.sport, activity.startedAt);
  return {
    version: PROJECTION_VERSION, source: { id: source.id, name: source.name, origin: source.origin }, activity,
    summary: { distance: summary.distance ?? activity.distance, duration: summary.timerTime ?? activity.duration,
      elapsed: summary.elapsedTime ?? elapsed.at(-1) ?? null, speed: summary.avgSpeed,
      heartRate: safeNumber(session.avg_heart_rate), cadence: summary.avgCadence, ascent: summary.totalAscent, calories: safeNumber(session.total_calories) },
    streams: { elapsed, distance, latitude, longitude, breakBefore, channels: available, recordIndex: rows.map(r => r.index) },
    laps: projectedLaps, zones,
    provenance: { sourceFields: [...summary.recordFields].sort(), algorithms: { projection: PROJECTION_VERSION, ...(derivedGrade ? { grade: "elevation-delta-10m-v1" } : {}) } },
    quality: { flags: [...flags], inputRecords: records.length, samples: rows.length, missing },
    derived: {
      intervals: { version: "1", status: "pending", sourceChannels: ["speed"] },
      zones: { version: "1", status: Object.keys(zones).length ? "available" : "pending", sourceChannels: Object.keys(zones) as Channel[] },
      weather: { version: "1", status: "pending", sourceChannels: [] },
      bestEfforts: { version: "1", status: "pending", sourceChannels: ["speed"] },
      efficiency: { version: "1", status: "pending", sourceChannels: ["heart_rate", "speed"] },
      plannedActual: { version: "1", status: "pending", sourceChannels: [] },
    },
  };
}

export function nearestIndex(values: number[], target: number): number {
  if (!values.length) return 0;
  let low = 0, high = values.length - 1;
  while (low < high) { const mid = (low + high) >>> 1; if (values[mid] < target) low = mid + 1; else high = mid; }
  return low > 0 && Math.abs(values[low - 1] - target) <= Math.abs(values[low] - target) ? low - 1 : low;
}

export interface ProjectionCacheEntry { fingerprint: string; projection: AnalysisProjection }
