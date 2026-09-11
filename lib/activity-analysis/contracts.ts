export type UnitSystem = "metric" | "imperial";
export type ActivityOrigin = "browser" | "backend";
export type FitRow = Record<string, any>;
export type DecodedFit = Record<string, any>;

export interface ActivitySource {
  id: string;
  name: string;
  size?: number;
  lastModified?: number;
  origin: ActivityOrigin;
  externalId?: string;
  sourceFileUrl?: string;
}

export interface ActivitySummary {
  session: FitRow;
  start: unknown;
  end: unknown;
  timerTime: number | null;
  elapsedTime: number | null;
  distance: number | null;
  avgSpeed: number | null;
  maxSpeed: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  totalAscent: number | null;
  totalDescent: number | null;
  recordFields: string[];
  lapCount: number;
  recordCount: number;
  decodedSectionCount: number;
}

export interface DecodedGroup {
  key: string;
  value: unknown;
  rows: FitRow[];
  count: number;
}

export interface AnalysedActivity {
  source: ActivitySource;
  parsed: DecodedFit;
  summary: ActivitySummary;
  records: FitRow[];
  laps: FitRow[];
  groups: DecodedGroup[];
}

export type ChartMetricKey =
  | "heart_rate"
  | "pace"
  | "speed"
  | "cadence"
  | "altitude"
  | "power"
  | "temperature"
  | "distance"
  | "grade"
  | "vertical_oscillation"
  | "ground_contact_time"
  | "respiration_rate";

export interface ChartMetricDefinition {
  key: ChartMetricKey;
  label: string;
  fields: string[];
  inverse?: boolean;
}

export interface ChartPoint {
  x: number;
  y: number;
  index: number;
  record: FitRow;
}

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface BrowserFitInput {
  bytes: Uint8Array;
  source: ActivitySource;
}

export interface RemoteFitInput {
  url: string;
  name: string;
  externalId?: string;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
}
