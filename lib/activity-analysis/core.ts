import type {
  ActivitySource,
  ActivitySummary,
  AnalysedActivity,
  ChartMetricDefinition,
  ChartMetricKey,
  ChartPoint,
  DecodedFit,
  DecodedGroup,
  FitRow,
  RoutePoint,
  UnitSystem,
} from "./contracts";

export const CHART_METRICS: ChartMetricDefinition[] = [
  { key: "heart_rate", label: "Heart rate", fields: ["heart_rate"] },
  { key: "pace", label: "Pace", fields: ["enhanced_speed", "speed"], inverse: true },
  { key: "speed", label: "Speed", fields: ["enhanced_speed", "speed"] },
  { key: "cadence", label: "Cadence", fields: ["cadence"] },
  { key: "altitude", label: "Altitude", fields: ["enhanced_altitude", "altitude"] },
  { key: "power", label: "Power", fields: ["power"] },
  { key: "temperature", label: "Temperature", fields: ["temperature"] },
  { key: "distance", label: "Distance", fields: ["distance"] },
  { key: "grade", label: "Grade", fields: ["grade"] },
  { key: "vertical_oscillation", label: "Vertical oscillation", fields: ["vertical_oscillation"] },
  { key: "ground_contact_time", label: "Ground contact time", fields: ["ground_contact_time"] },
  { key: "respiration_rate", label: "Respiration rate", fields: ["respiration_rate"] },
];

export function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = safeNumber(value);
    if (number !== null) return number;
  }
  return null;
}

export function getSession(parsed: DecodedFit): FitRow {
  return parsed?.sessions?.[0] ?? parsed?.activity?.sessions?.[0] ?? {};
}

export function getRecords(parsed: DecodedFit): FitRow[] {
  return Array.isArray(parsed?.records) ? parsed.records : [];
}

export function getLaps(parsed: DecodedFit): FitRow[] {
  return Array.isArray(parsed?.laps) ? parsed.laps : [];
}

export function isRunningSession(session: FitRow): boolean {
  return String(session?.sport ?? "").toLowerCase() === "running";
}

export function cadenceDisplay(cadence: unknown, session: FitRow): number | null {
  const value = safeNumber(cadence);
  if (value === null) return null;
  return isRunningSession(session) ? value * 2 : value;
}

export function unionKeys(rows: FitRow[], exclude: string[] = []): string[] {
  const keys: string[] = [];
  const seen = new Set(exclude);
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

export function extractGroups(parsed: DecodedFit): DecodedGroup[] {
  if (!parsed || typeof parsed !== "object") return [];
  const priority = ["activity", "sessions", "laps", "records", "events", "device_infos", "sports", "time_in_zone"];
  return Object.entries(parsed)
    .filter(([key]) => !["profileVersion", "protocolVersion"].includes(key))
    .map(([key, value]) => {
      const rows: FitRow[] = Array.isArray(value)
        ? value
        : value && typeof value === "object"
          ? [value as FitRow]
          : [{ value }];
      return { key, value, rows, count: Array.isArray(value) ? value.length : 1 };
    })
    .sort((a, b) => {
      const ai = priority.indexOf(a.key);
      const bi = priority.indexOf(b.key);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.key.localeCompare(b.key);
    });
}

function getStartTime(parsed: DecodedFit, session: FitRow): unknown {
  return session?.start_time ?? parsed?.file_ids?.[0]?.time_created ?? parsed?.activity?.timestamp ?? null;
}

function getEndTime(parsed: DecodedFit, session: FitRow): unknown {
  return session?.timestamp ?? parsed?.activity?.timestamp ?? null;
}

export function buildSummary(parsed: DecodedFit): ActivitySummary {
  const session = getSession(parsed);
  const records = getRecords(parsed);
  const timerTime = firstNumber(session.total_timer_time, parsed?.activity?.total_timer_time);
  const elapsedTime = firstNumber(session.total_elapsed_time, timerTime);
  const distance = firstNumber(session.total_distance, records.at(-1)?.distance);
  const avgSpeed = firstNumber(
    session.enhanced_avg_speed,
    session.avg_speed,
    distance !== null && timerTime !== null && timerTime > 0 ? distance / timerTime : null,
  );
  return {
    session,
    start: getStartTime(parsed, session),
    end: getEndTime(parsed, session),
    timerTime,
    elapsedTime,
    distance,
    avgSpeed,
    maxSpeed: firstNumber(session.enhanced_max_speed, session.max_speed),
    avgCadence: cadenceDisplay(firstNumber(session.avg_cadence, session.avg_running_cadence), session),
    maxCadence: cadenceDisplay(firstNumber(session.max_cadence, session.max_running_cadence), session),
    totalAscent: firstNumber(session.total_ascent),
    totalDescent: firstNumber(session.total_descent),
    recordFields: unionKeys(records),
    lapCount: getLaps(parsed).length,
    recordCount: records.length,
    decodedSectionCount: extractGroups(parsed).length,
  };
}

export function analyseDecodedFit(source: ActivitySource, parsed: DecodedFit): AnalysedActivity {
  return {
    source,
    parsed,
    summary: buildSummary(parsed),
    records: getRecords(parsed),
    laps: getLaps(parsed),
    groups: extractGroups(parsed),
  };
}

export function normaliseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDuration(seconds: number | null, milliseconds = false): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const totalMs = Math.max(0, seconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = Math.round(totalMs % 1000);
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
  return milliseconds ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

export function metresToDisplay(metres: number | null, units: UnitSystem): number | null {
  if (metres === null) return null;
  return units === "metric" ? metres / 1000 : metres / 1609.344;
}

export function speedToDisplay(mps: number | null, units: UnitSystem): number | null {
  if (mps === null) return null;
  return units === "metric" ? mps * 3.6 : mps * 2.2369362921;
}

export function paceSecondsFromSpeed(mps: number | null, units: UnitSystem): number | null {
  if (mps === null || mps <= 0) return null;
  return (units === "metric" ? 1000 : 1609.344) / mps;
}

export function formatDistance(metres: number | null, units: UnitSystem, digits = 2): string {
  const value = metresToDisplay(metres, units);
  return value === null ? "—" : `${value.toFixed(digits)} ${units === "metric" ? "km" : "mi"}`;
}

export function formatSpeed(mps: number | null, units: UnitSystem, digits = 1): string {
  const value = speedToDisplay(mps, units);
  return value === null ? "—" : `${value.toFixed(digits)} ${units === "metric" ? "km/h" : "mph"}`;
}

export function formatPace(mps: number | null, units: UnitSystem): string {
  const seconds = paceSecondsFromSpeed(mps, units);
  if (seconds === null || seconds > 3600) return "—";
  return `${formatDuration(seconds)} ${units === "metric" ? "/km" : "/mi"}`;
}

function recordField(record: FitRow, fields: string[]): number | null {
  for (const field of fields) {
    const value = safeNumber(record?.[field]);
    if (value !== null) return value;
  }
  return null;
}

export function availableChartMetrics(records: FitRow[]): ChartMetricDefinition[] {
  return CHART_METRICS.filter((metric) => records.some((record) => recordField(record, metric.fields) !== null));
}

function elapsedSeconds(record: FitRow, firstTimestamp: Date | null, index: number): number {
  const elapsed = safeNumber(record.elapsed_time);
  if (elapsed !== null) return elapsed;
  const timer = safeNumber(record.timer_time);
  if (timer !== null) return timer;
  const timestamp = normaliseDate(record.timestamp);
  if (timestamp && firstTimestamp) return (timestamp.getTime() - firstTimestamp.getTime()) / 1000;
  return index;
}

export function buildChartSeries(
  parsed: DecodedFit,
  metricKey: ChartMetricKey,
  units: UnitSystem,
): ChartPoint[] {
  const records = getRecords(parsed);
  const session = getSession(parsed);
  const metric = CHART_METRICS.find((candidate) => candidate.key === metricKey);
  if (!metric) return [];
  const firstTimestamp = normaliseDate(records.find((record) => normaliseDate(record.timestamp))?.timestamp);
  const points: ChartPoint[] = [];
  records.forEach((record, index) => {
    const raw = recordField(record, metric.fields);
    if (raw === null) return;
    let y: number | null = raw;
    if (metricKey === "pace") y = paceSecondsFromSpeed(raw, units);
    if (metricKey === "speed") y = speedToDisplay(raw, units);
    if (metricKey === "cadence") y = cadenceDisplay(raw, session);
    if (metricKey === "altitude" && units === "imperial") y = raw * 3.280839895;
    if (metricKey === "distance") y = metresToDisplay(raw, units);
    if (y === null || !Number.isFinite(y)) return;
    points.push({ x: elapsedSeconds(record, firstTimestamp, index), y, index, record });
  });
  return points;
}

export function semicirclesToDegrees(value: unknown): number | null {
  const number = safeNumber(value);
  if (number === null) return null;
  return Math.abs(number) > 180 ? number * (180 / 2147483648) : number;
}

export function buildRoute(parsed: DecodedFit): RoutePoint[] {
  return getRecords(parsed)
    .map((record) => {
      const lat = semicirclesToDegrees(firstNumber(record.position_lat, record.latitude));
      const lon = semicirclesToDegrees(firstNumber(record.position_long, record.longitude));
      return lat === null || lon === null ? null : { lat, lon };
    })
    .filter((point): point is RoutePoint => point !== null);
}

export function serialisable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => serialisable(item, seen));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialisable(item, seen)]));
  }
  return value;
}

function csvEscape(value: unknown): string {
  const text = value instanceof Date
    ? value.toISOString()
    : value && typeof value === "object"
      ? JSON.stringify(serialisable(value))
      : String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(rows: FitRow[]): string {
  if (!rows.length) return "";
  const columns = unionKeys(rows);
  return [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row?.[column])).join(",")),
  ].join("\r\n");
}
