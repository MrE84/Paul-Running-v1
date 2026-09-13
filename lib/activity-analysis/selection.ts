import { CHANNELS, type AnalysisProjection, type Axis, type Channel, type IndexRange, type Values } from "./projection";
import type { UnitSystem } from "./contracts";
import { formatDuration } from "./core";

export function channelUnit(key: Channel, units: UnitSystem): string {
  if (units === "imperial") {
    if (key === "pace") return "min/mi";
    if (key === "altitude") return "ft";
    if (key === "temperature") return "°F";
  }
  return CHANNELS[key].unit;
}
export function displayValue(key: Channel, value: number | null, units: UnitSystem): number | null {
  if (value === null) return null;
  if (units === "imperial") {
    if (key === "pace") return value * 1.609344;
    if (key === "altitude") return value * 3.28084;
    if (key === "temperature") return value * 1.8 + 32;
  }
  return value;
}
export function formatChannel(key: Channel, value: number | null | undefined, units: UnitSystem): string {
  if (value == null) return "—";
  const n = displayValue(key, value, units)!;
  return key === "pace" ? formatDuration(n) : n.toFixed(key === "speed" || key === "grade" || key === "temperature" || key === "vertical_oscillation" ? 1 : 0);
}
export function rangeSummary(p: AnalysisProjection, range: IndexRange | null) {
  const [start, end] = range ?? [0, p.streams.elapsed.length - 1];
  const { elapsed, distance, channels, breakBefore } = p.streams;
  const means: Partial<Record<Channel, number | null>> = {};
  for (const key of Object.keys(channels) as Channel[]) {
    let sum = 0, weight = 0;
    for (let i = start; i < end; i++) {
      const value = channels[key]![i];
      const dt = elapsed[i + 1] - elapsed[i];
      if (value !== null && dt > 0 && !breakBefore[i + 1]) { sum += value * dt; weight += dt; }
    }
    means[key] = weight ? sum / weight : channels[key]?.[start] ?? null;
  }
  const d0 = distance[start], d1 = distance[end];
  const duration = end >= start && elapsed[end] !== undefined ? elapsed[end] - elapsed[start] : 0;
  return { duration, distance: d0 != null && d1 != null ? Math.max(0, d1 - d0) : null, means };
}

/** Time-window smoothing with nulls/gaps preserved. O(n), independent of recording rate. */
export function smoothValues(values: Values, elapsed: number[], breaks: boolean[], seconds: number): Values {
  if (!seconds) return values;
  let left = 0, sum = 0, count = 0;
  return values.map((value, i) => {
    if (breaks[i]) { left = i; sum = 0; count = 0; }
    if (value !== null) { sum += value; count++; }
    while (left < i && elapsed[i] - elapsed[left] > seconds) {
      if (values[left] !== null) { sum -= values[left]!; count--; }
      left++;
    }
    return value === null ? null : count ? sum / count : null;
  });
}

/** Shared min/max buckets preserve peaks in every visible trace and retain raw sample mapping. */
export function chartSamples(p: AnalysisProjection, keys: Channel[], axis: Axis, maxPoints: number, smoothing: number, units: UnitSystem) {
  const { elapsed, distance, breakBefore } = p.streams;
  const n = elapsed.length;
  const values = keys.map(k => smoothValues(p.streams.channels[k] ?? new Array(n).fill(null), elapsed, breakBefore, smoothing));
  const selected = new Set<number>(n ? [0, n - 1] : []);
  const bucket = Math.max(1, Math.ceil(n / Math.max(1, maxPoints / Math.max(2, keys.length * 2 + 2))));
  for (let start = 0; start < n; start += bucket) {
    const end = Math.min(n, start + bucket);
    selected.add(start); selected.add(end - 1);
    for (const series of values) {
      let min = start, max = start;
      for (let i = start; i < end; i++) {
        if (series[i] !== null && (series[min] === null || series[i]! < series[min]!)) min = i;
        if (series[i] !== null && (series[max] === null || series[i]! > series[max]!)) max = i;
      }
      selected.add(min); selected.add(max);
    }
  }
  // Preserve discontinuities: neither smoothing nor downsampling may reconnect missing data.
  for (let i = 1; i < n; i++) {
    if (breakBefore[i] || values.some(s => (s[i] === null) !== (s[i - 1] === null))) { selected.add(i - 1); selected.add(i); }
  }
  const indices = [...selected].sort((a, b) => a - b).filter(i => axis === "time" || distance[i] !== null);
  // uPlot requires strictly ascending X. Stationary distance samples remain in source/range stats.
  const unique = indices.filter((i, j) => axis === "time" || j === 0 || distance[i]! > distance[indices[j - 1]]!);
  const x = unique.map(i => axis === "time" ? elapsed[i] : distance[i]! / (units === "metric" ? 1000 : 1609.344));
  return { indices: unique, data: [x, ...values.map((s, k) => unique.map(i => breakBefore[i] ? null : displayValue(keys[k], s[i], units)))] as [number[], ...Values[]] };
}

export interface PrivacyRegion { latitude: number; longitude: number; radius: number }
export interface RouteSample { index: number; lat: number; lon: number; segment: number }
export function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function routeSamples(p: AnalysisProjection, endpointRadius: number, regions: PrivacyRegion[], density = 2000): RouteSample[] {
  const all = p.streams.latitude.map((lat, i) => lat !== null && p.streams.longitude[i] !== null ? { index: i, lat, lon: p.streams.longitude[i]!, segment: 0 } : null);
  const first = all.find(v => v !== null), last = all.findLast(v => v !== null);
  const masks = [...regions];
  if (endpointRadius && first && last) masks.push(...[first, last].map(v => ({ latitude: v.lat, longitude: v.lon, radius: endpointRadius })));
  let segment = 0;
  const visible: RouteSample[] = [];
  for (const point of all) {
    if (!point || masks.some(m => metresBetween(point, { lat: m.latitude, lon: m.longitude }) < m.radius)) { segment++; continue; }
    if (p.streams.breakBefore[point.index]) segment++;
    visible.push({ ...point, segment });
  }
  const step = Math.max(1, Math.ceil(visible.length / density));
  const laps = new Set(p.laps.flatMap(l => [l.start, l.end]));
  return visible.filter((p, i) => i % step === 0 || laps.has(p.index) || visible[i - 1]?.segment !== p.segment || visible[i + 1]?.segment !== p.segment);
}
