import { type AnalysisProjection, type Channel, type Values } from "./projection";
import { metresBetween, routeSamples, type PrivacyRegion } from "./selection";

export const QUALITY_VERSION = "1.0.0";

export interface AnalysisAnomaly {
  id: string;
  channel: Channel | "gps";
  index: number;
  elapsedSeconds: number;
  value: number | null;
  kind: "range" | "spike" | "gps_jump";
  severity: "warning" | "error";
  message: string;
}

export interface CorrectionLayer {
  version: string;
  channel: Channel;
  method: "remove" | "interpolate";
  values: Values;
  correctedIndices: number[];
  provenance: string;
}

export interface PerformanceProfile {
  samples: number;
  availableChannels: number;
  estimatedRawNumericValues: number;
  recommendedTimelinePoints: number;
  reductionRatio: number;
  largeActivity: boolean;
}

const LIMITS: Partial<Record<Channel, { minimum: number; maximum: number; deltaPerSecond: number }>> = {
  heart_rate: { minimum: 30, maximum: 240, deltaPerSecond: 28 },
  speed: { minimum: 0, maximum: 15, deltaPerSecond: 8 },
  pace: { minimum: 55, maximum: 3600, deltaPerSecond: 500 },
  cadence: { minimum: 0, maximum: 280, deltaPerSecond: 90 },
  power: { minimum: 0, maximum: 2500, deltaPerSecond: 1000 },
  altitude: { minimum: -500, maximum: 9000, deltaPerSecond: 35 },
  grade: { minimum: -70, maximum: 70, deltaPerSecond: 50 },
  temperature: { minimum: -60, maximum: 80, deltaPerSecond: 15 },
  ambient_temperature: { minimum: -60, maximum: 65, deltaPerSecond: 15 },
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

/** Flags hard-range failures, abrupt signal spikes and impossible GPS jumps without editing source data. */
export function detectAnalysisAnomalies(projection: AnalysisProjection): AnalysisAnomaly[] {
  const anomalies: AnalysisAnomaly[] = [];
  const cycling = /cycl|bike/i.test(projection.activity.sport);
  for (const [channel, values] of Object.entries(projection.streams.channels) as Array<[Channel, Values]>) {
    const configured = LIMITS[channel];
    const limits = configured && cycling && channel === "speed" ? { ...configured, maximum: 45 }
      : configured && cycling && channel === "pace" ? { ...configured, minimum: 22 }
        : configured;
    if (!limits) continue;
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      if (!finite(value)) continue;
      if (value < limits.minimum || value > limits.maximum) {
        anomalies.push({ id: `${channel}-range-${index}`, channel, index, elapsedSeconds: projection.streams.elapsed[index] ?? index, value, kind: "range", severity: "error", message: `${channel.replaceAll("_", " ")} is outside the supported physiological range.` });
        continue;
      }
      if (!index || projection.streams.breakBefore[index] || !finite(values[index - 1])) continue;
      const seconds = projection.streams.elapsed[index] - projection.streams.elapsed[index - 1];
      if (seconds > 0 && Math.abs(value - values[index - 1]!) / seconds > limits.deltaPerSecond) {
        anomalies.push({ id: `${channel}-spike-${index}`, channel, index, elapsedSeconds: projection.streams.elapsed[index], value, kind: "spike", severity: "warning", message: `${channel.replaceAll("_", " ")} changes faster than the configured spike threshold.` });
      }
    }
    // A robust local outlier pass catches isolated spikes that remain inside broad hard limits.
    for (let index = 2; index < values.length - 2; index++) {
      if (!finite(values[index]) || projection.streams.breakBefore.slice(index - 1, index + 2).some(Boolean)) continue;
      const neighbours = [values[index - 2], values[index - 1], values[index + 1], values[index + 2]].filter(finite);
      if (neighbours.length < 3) continue;
      const centre = median(neighbours);
      const deviation = median(neighbours.map(value => Math.abs(value - centre)));
      const floor = channel === "heart_rate" ? 12 : channel === "pace" ? 90 : channel === "altitude" ? 20 : 25;
      if (Math.abs(values[index]! - centre) > Math.max(floor, deviation * 8) && !anomalies.some(item => item.channel === channel && item.index === index)) {
        anomalies.push({ id: `${channel}-robust-${index}`, channel, index, elapsedSeconds: projection.streams.elapsed[index], value: values[index]!, kind: "spike", severity: "warning", message: `${channel.replaceAll("_", " ")} is an isolated local outlier.` });
      }
    }
  }
  let previous: { index: number; lat: number; lon: number } | null = null;
  for (let index = 0; index < projection.streams.latitude.length; index++) {
    const lat = projection.streams.latitude[index];
    const lon = projection.streams.longitude[index];
    if (!finite(lat) || !finite(lon)) continue;
    if (previous && !projection.streams.breakBefore[index]) {
      const seconds = projection.streams.elapsed[index] - projection.streams.elapsed[previous.index];
      const speed = seconds > 0 ? metresBetween(previous, { lat, lon }) / seconds : 0;
      const maximumRouteSpeed = cycling ? 45 : 18;
      if (speed > maximumRouteSpeed) anomalies.push({ id: `gps-jump-${index}`, channel: "gps", index, elapsedSeconds: projection.streams.elapsed[index], value: speed, kind: "gps_jump", severity: "error", message: `GPS moved at ${speed.toFixed(1)} m/s, above the ${cycling ? "cycling" : "running"} route threshold.` });
    }
    previous = { index, lat, lon };
  }
  return anomalies.sort((a, b) => a.index - b.index || a.channel.localeCompare(b.channel));
}

function replacement(values: Values, index: number): number | null {
  let before = index - 1;
  let after = index + 1;
  while (before >= 0 && !finite(values[before])) before--;
  while (after < values.length && !finite(values[after])) after++;
  if (before >= 0 && after < values.length) return (values[before]! + values[after]!) / 2;
  return before >= 0 ? values[before] : after < values.length ? values[after] : null;
}

export function buildCorrectionLayer(projection: AnalysisProjection, channel: Channel, anomalies: AnalysisAnomaly[], method: CorrectionLayer["method"] = "interpolate"): CorrectionLayer {
  const source = projection.streams.channels[channel] ?? [];
  const values = [...source];
  const correctedIndices = [...new Set(anomalies.filter(item => item.channel === channel).map(item => item.index))].sort((a, b) => a - b);
  for (const index of correctedIndices) values[index] = method === "remove" ? null : replacement(source, index);
  return { version: QUALITY_VERSION, channel, method, values, correctedIndices, provenance: `non-destructive-${method}-flagged-samples-v1` };
}

export function applyCorrectionLayers(projection: AnalysisProjection, layers: CorrectionLayer[]): AnalysisProjection {
  const channels = { ...projection.streams.channels };
  for (const layer of layers) channels[layer.channel] = [...layer.values];
  return {
    ...projection,
    streams: { ...projection.streams, channels },
    provenance: { ...projection.provenance, algorithms: { ...projection.provenance.algorithms, ...Object.fromEntries(layers.map(layer => [`correction:${layer.channel}`, layer.provenance])) } },
    quality: { ...projection.quality, flags: [...projection.quality.flags, ...layers.filter(layer => layer.correctedIndices.length).map(layer => `${layer.correctedIndices.length} ${layer.channel.replaceAll("_", " ")} samples corrected for display only.`)] },
  };
}

export function performanceProfile(projection: AnalysisProjection): PerformanceProfile {
  const samples = projection.streams.elapsed.length;
  const availableChannels = Object.keys(projection.streams.channels).length;
  const recommendedTimelinePoints = samples > 20_000 ? 1800 : samples > 8_000 ? 2400 : 6000;
  return {
    samples,
    availableChannels,
    estimatedRawNumericValues: samples * (availableChannels + 5),
    recommendedTimelinePoints,
    reductionRatio: samples ? Math.min(1, recommendedTimelinePoints / samples) : 1,
    largeActivity: samples > 20_000,
  };
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** GPX export uses the exact same privacy predicate as the map and emits separate track segments across every mask/gap. */
export function privacySafeGpx(projection: AnalysisProjection, endpointRadius: number, regions: PrivacyRegion[] = []): string {
  const points = routeSamples(projection, endpointRadius, regions, Number.MAX_SAFE_INTEGER);
  const segments = new Map<number, typeof points>();
  for (const point of points) {
    const segment = segments.get(point.segment) ?? [];
    segment.push(point);
    segments.set(point.segment, segment);
  }
  const tracks = [...segments.values()].filter(segment => segment.length > 1).map(segment => `<trkseg>${segment.map(point => {
    const time = projection.activity.startedAt
      ? new Date(Date.parse(projection.activity.startedAt) + projection.streams.elapsed[point.index] * 1000).toISOString()
      : null;
    return `<trkpt lat="${point.lat.toFixed(6)}" lon="${point.lon.toFixed(6)}">${time ? `<time>${time}</time>` : ""}</trkpt>`;
  }).join("")}</trkseg>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Paul's Running" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${xml(projection.activity.title)}</name></metadata><trk><name>${xml(projection.activity.title)}</name>${tracks}</trk></gpx>`;
}
