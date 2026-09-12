import type { ActivitySource, DecodedFit, FitRow } from "./contracts";
import {
  cadenceDisplay,
  firstNumber,
  getLaps,
  getRecords,
  getSession,
  normaliseDate,
  normaliseDecodedFit,
  paceSecondsFromSpeed,
  safeNumber,
  semicirclesToDegrees,
} from "./core";

export const ACTIVITY_ANALYSIS_PROJECTION_VERSION = "1.0.0";
export const ACTIVITY_ANALYSIS_ALGORITHM_VERSION = "2026-09-batch-a";

export type AnalysisChannelKey =
  | "latitude"
  | "longitude"
  | "altitudeMeters"
  | "gradePercent"
  | "speedMps"
  | "paceSecondsPerKm"
  | "heartRateBpm"
  | "cadenceSpm"
  | "powerWatts"
  | "temperatureC"
  | "verticalOscillationMm"
  | "groundContactTimeMs"
  | "respirationRateBpm";

export interface AnalysisStreamPoint {
  index: number;
  elapsedSeconds: number;
  distanceMeters: number | null;
  timestamp: string | null;
  channels: Partial<Record<AnalysisChannelKey, number>>;
}

export interface AnalysisLapProjection {
  index: number;
  startElapsedSeconds: number | null;
  elapsedSeconds: number | null;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  avgSpeedMps: number | null;
  avgCadenceSpm: number | null;
}

export interface ActivityAnalysisProjection {
  projectionVersion: string;
  algorithmVersion: string;
  generatedAt: null;
  source: Pick<ActivitySource, "id" | "name" | "origin" | "externalId">;
  activity: {
    sport: string | null;
    subSport: string | null;
    startedAt: string | null;
    elapsedSeconds: number | null;
    timerSeconds: number | null;
    distanceMeters: number | null;
    avgHeartRateBpm: number | null;
    maxHeartRateBpm: number | null;
    avgSpeedMps: number | null;
    maxSpeedMps: number | null;
    avgCadenceSpm: number | null;
    totalAscentMeters: number | null;
    totalDescentMeters: number | null;
  };
  sourceChannels: AnalysisChannelKey[];
  stream: AnalysisStreamPoint[];
  laps: AnalysisLapProjection[];
  derived: {
    intervals: { version: string; items: unknown[] };
    zones: { version: string; items: unknown[] };
    weather: { version: string; status: "not_enriched" | "enriched"; data: unknown | null };
    bestEfforts: { version: string; items: unknown[] };
    efficiency: { version: string; aerobicDecouplingPercent: number | null };
    dataQuality: {
      version: string;
      recordCount: number;
      gpsPointCount: number;
      missingChannels: AnalysisChannelKey[];
      duplicateElapsedPoints: number;
      nonMonotonicDistancePoints: number;
    };
    plannedAlignment: { version: string; status: "not_linked" | "linked"; data: unknown | null };
  };
  diagnostics: {
    streamPointCount: number;
    approximateJsonBytes: number;
  };
}

function iso(value: unknown): string | null {
  return normaliseDate(value)?.toISOString() ?? null;
}

function field(record: FitRow, ...keys: string[]): number | null {
  return firstNumber(...keys.map((key) => record?.[key]));
}

function elapsedSeconds(record: FitRow, firstTimestamp: Date | null, index: number): number {
  const direct = firstNumber(record.elapsed_time, record.timer_time);
  if (direct !== null) return Math.max(0, direct);
  const timestamp = normaliseDate(record.timestamp);
  if (timestamp && firstTimestamp) return Math.max(0, (timestamp.getTime() - firstTimestamp.getTime()) / 1000);
  return index;
}

function buildChannels(record: FitRow, session: FitRow): Partial<Record<AnalysisChannelKey, number>> {
  const channels: Partial<Record<AnalysisChannelKey, number>> = {};
  const latitude = semicirclesToDegrees(firstNumber(record.position_lat, record.latitude));
  const longitude = semicirclesToDegrees(firstNumber(record.position_long, record.longitude));
  const altitude = field(record, "enhanced_altitude", "altitude");
  const grade = field(record, "grade");
  const speed = field(record, "enhanced_speed", "speed");
  const heartRate = field(record, "heart_rate");
  const cadence = cadenceDisplay(firstNumber(record.cadence, record.running_cadence), session);
  const power = field(record, "power");
  const temperature = field(record, "temperature");
  const verticalOscillation = field(record, "vertical_oscillation");
  const groundContactTime = field(record, "ground_contact_time");
  const respirationRate = field(record, "respiration_rate");

  if (latitude !== null) channels.latitude = latitude;
  if (longitude !== null) channels.longitude = longitude;
  if (altitude !== null) channels.altitudeMeters = altitude;
  if (grade !== null) channels.gradePercent = grade;
  if (speed !== null) {
    channels.speedMps = speed;
    const pace = paceSecondsFromSpeed(speed, "metric");
    if (pace !== null && pace < 3600) channels.paceSecondsPerKm = pace;
  }
  if (heartRate !== null) channels.heartRateBpm = heartRate;
  if (cadence !== null) channels.cadenceSpm = cadence;
  if (power !== null) channels.powerWatts = power;
  if (temperature !== null) channels.temperatureC = temperature;
  if (verticalOscillation !== null) channels.verticalOscillationMm = verticalOscillation;
  if (groundContactTime !== null) channels.groundContactTimeMs = groundContactTime;
  if (respirationRate !== null) channels.respirationRateBpm = respirationRate;
  return channels;
}

function aerobicDecoupling(stream: AnalysisStreamPoint[]): number | null {
  const usable = stream.filter((point) => {
    const hr = point.channels.heartRateBpm;
    const speed = point.channels.speedMps;
    return typeof hr === "number" && hr > 0 && typeof speed === "number" && speed > 0;
  });
  if (usable.length < 20) return null;
  const midpoint = Math.floor(usable.length / 2);
  const ratio = (rows: AnalysisStreamPoint[]) => {
    const values = rows.map((point) => (point.channels.speedMps as number) / (point.channels.heartRateBpm as number));
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const first = ratio(usable.slice(0, midpoint));
  const second = ratio(usable.slice(midpoint));
  if (!first) return null;
  return Number((((second - first) / first) * 100).toFixed(2));
}

function lapProjection(lap: FitRow, index: number, session: FitRow): AnalysisLapProjection {
  return {
    index,
    startElapsedSeconds: firstNumber(lap.start_elapsed_time, lap.start_timer_time),
    elapsedSeconds: firstNumber(lap.total_elapsed_time, lap.total_timer_time),
    distanceMeters: firstNumber(lap.total_distance),
    avgHeartRateBpm: firstNumber(lap.avg_heart_rate),
    maxHeartRateBpm: firstNumber(lap.max_heart_rate),
    avgSpeedMps: firstNumber(lap.enhanced_avg_speed, lap.avg_speed),
    avgCadenceSpm: cadenceDisplay(firstNumber(lap.avg_cadence, lap.avg_running_cadence), session),
  };
}

export function buildActivityAnalysisProjection(
  source: ActivitySource,
  decoded: DecodedFit,
): ActivityAnalysisProjection {
  const parsed = normaliseDecodedFit(decoded);
  const session = getSession(parsed);
  const records = getRecords(parsed);
  const firstTimestamp = normaliseDate(records.find((record) => normaliseDate(record.timestamp))?.timestamp);
  const stream = records.map((record, index): AnalysisStreamPoint => ({
    index,
    elapsedSeconds: elapsedSeconds(record, firstTimestamp, index),
    distanceMeters: field(record, "distance"),
    timestamp: iso(record.timestamp),
    channels: buildChannels(record, session),
  }));
  const sourceChannels = [...new Set(stream.flatMap((point) => Object.keys(point.channels) as AnalysisChannelKey[]))].sort() as AnalysisChannelKey[];
  const allChannels: AnalysisChannelKey[] = [
    "latitude", "longitude", "altitudeMeters", "gradePercent", "speedMps", "paceSecondsPerKm",
    "heartRateBpm", "cadenceSpm", "powerWatts", "temperatureC", "verticalOscillationMm",
    "groundContactTimeMs", "respirationRateBpm",
  ];
  let duplicateElapsedPoints = 0;
  let nonMonotonicDistancePoints = 0;
  for (let index = 1; index < stream.length; index += 1) {
    if (stream[index].elapsedSeconds === stream[index - 1].elapsedSeconds) duplicateElapsedPoints += 1;
    const previous = stream[index - 1].distanceMeters;
    const current = stream[index].distanceMeters;
    if (previous !== null && current !== null && current < previous) nonMonotonicDistancePoints += 1;
  }

  const projection: ActivityAnalysisProjection = {
    projectionVersion: ACTIVITY_ANALYSIS_PROJECTION_VERSION,
    algorithmVersion: ACTIVITY_ANALYSIS_ALGORITHM_VERSION,
    generatedAt: null,
    source: {
      id: source.id,
      name: source.name,
      origin: source.origin,
      ...(source.externalId ? { externalId: source.externalId } : {}),
    },
    activity: {
      sport: typeof session.sport === "string" ? session.sport : null,
      subSport: typeof session.sub_sport === "string" ? session.sub_sport : null,
      startedAt: iso(session.start_time ?? firstTimestamp),
      elapsedSeconds: firstNumber(session.total_elapsed_time, session.total_timer_time),
      timerSeconds: firstNumber(session.total_timer_time),
      distanceMeters: firstNumber(session.total_distance, stream.at(-1)?.distanceMeters),
      avgHeartRateBpm: firstNumber(session.avg_heart_rate),
      maxHeartRateBpm: firstNumber(session.max_heart_rate),
      avgSpeedMps: firstNumber(session.enhanced_avg_speed, session.avg_speed),
      maxSpeedMps: firstNumber(session.enhanced_max_speed, session.max_speed),
      avgCadenceSpm: cadenceDisplay(firstNumber(session.avg_cadence, session.avg_running_cadence), session),
      totalAscentMeters: firstNumber(session.total_ascent),
      totalDescentMeters: firstNumber(session.total_descent),
    },
    sourceChannels,
    stream,
    laps: getLaps(parsed).map((lap, index) => lapProjection(lap, index, session)),
    derived: {
      intervals: { version: "1", items: [] },
      zones: { version: "1", items: [] },
      weather: { version: "1", status: "not_enriched", data: null },
      bestEfforts: { version: "1", items: [] },
      efficiency: { version: "1", aerobicDecouplingPercent: aerobicDecoupling(stream) },
      dataQuality: {
        version: "1",
        recordCount: records.length,
        gpsPointCount: stream.filter((point) => point.channels.latitude !== undefined && point.channels.longitude !== undefined).length,
        missingChannels: allChannels.filter((key) => !sourceChannels.includes(key)),
        duplicateElapsedPoints,
        nonMonotonicDistancePoints,
      },
      plannedAlignment: { version: "1", status: "not_linked", data: null },
    },
    diagnostics: { streamPointCount: stream.length, approximateJsonBytes: 0 },
  };
  projection.diagnostics.approximateJsonBytes = JSON.stringify(projection).length;
  return projection;
}

export function projectionCacheKey(sourceId: string): string {
  return `${sourceId}:${ACTIVITY_ANALYSIS_PROJECTION_VERSION}:${ACTIVITY_ANALYSIS_ALGORITHM_VERSION}`;
}

export function selectProjectionRange(
  projection: ActivityAnalysisProjection,
  startIndex: number,
  endIndex: number,
): AnalysisStreamPoint[] {
  const low = Math.max(0, Math.min(startIndex, endIndex));
  const high = Math.min(projection.stream.length - 1, Math.max(startIndex, endIndex));
  return projection.stream.slice(low, high + 1);
}

export function summarizeProjectionRange(points: AnalysisStreamPoint[]) {
  const average = (key: AnalysisChannelKey): number | null => {
    const values = points.map((point) => point.channels[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const start = points[0];
  const end = points.at(-1);
  return {
    elapsedSeconds: start && end ? Math.max(0, end.elapsedSeconds - start.elapsedSeconds) : null,
    distanceMeters: start?.distanceMeters !== null && start?.distanceMeters !== undefined && end?.distanceMeters !== null && end?.distanceMeters !== undefined
      ? Math.max(0, end.distanceMeters - start.distanceMeters)
      : null,
    avgHeartRateBpm: average("heartRateBpm"),
    avgSpeedMps: average("speedMps"),
    avgCadenceSpm: average("cadenceSpm"),
    avgPowerWatts: average("powerWatts"),
    avgGradePercent: average("gradePercent"),
  };
}
