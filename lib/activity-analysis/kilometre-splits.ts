import type { AnalysisProjection } from "./projection";

export interface KilometreSplit {
  id: string;
  label: string;
  distanceMeters: number;
  durationSeconds: number;
  paceSecondsPerKm: number;
  deltaSeconds: number | null;
  startIndex: number;
  endIndex: number;
}

interface DistancePoint {
  index: number;
  distance: number;
  elapsed: number;
}

function validDistancePoints(projection: AnalysisProjection): DistancePoint[] {
  const points: DistancePoint[] = [];
  let previousDistance = -Infinity;

  projection.streams.distance.forEach((value, index) => {
    const elapsed = projection.streams.elapsed[index];
    if (value == null || !Number.isFinite(value) || !Number.isFinite(elapsed)) return;
    if (value < previousDistance) return;
    previousDistance = value;
    points.push({ index, distance: value, elapsed });
  });

  return points;
}

function boundaryAtDistance(points: DistancePoint[], targetMeters: number): { elapsed: number; index: number } | null {
  if (!points.length) return null;
  if (targetMeters <= 0) return { elapsed: 0, index: points[0].index };

  let previous = points[0];
  if (targetMeters <= previous.distance) {
    const fraction = previous.distance > 0 ? targetMeters / previous.distance : 0;
    return { elapsed: previous.elapsed * fraction, index: previous.index };
  }

  for (let i = 1; i < points.length; i += 1) {
    const current = points[i];
    if (current.distance < targetMeters) {
      previous = current;
      continue;
    }

    const distanceDelta = current.distance - previous.distance;
    const fraction = distanceDelta > 0 ? (targetMeters - previous.distance) / distanceDelta : 0;
    return {
      elapsed: previous.elapsed + fraction * (current.elapsed - previous.elapsed),
      index: current.index,
    };
  }

  const last = points.at(-1)!;
  return targetMeters <= last.distance + 1 ? { elapsed: last.elapsed, index: last.index } : null;
}

/**
 * Builds fixed 1 km splits from the continuous distance trace rather than relying on FIT lap markers.
 * The final partial kilometre is included when it is at least `minPartialMeters` long.
 */
export function buildKilometreSplits(projection: AnalysisProjection, minPartialMeters = 100): KilometreSplit[] {
  const points = validDistancePoints(projection);
  if (points.length < 2) return [];

  const totalDistance = points.at(-1)!.distance;
  if (!Number.isFinite(totalDistance) || totalDistance < 1000) return [];

  const fullKilometres = Math.floor(totalDistance / 1000);
  const remainderMeters = totalDistance - fullKilometres * 1000;
  const boundaries = Array.from({ length: fullKilometres + 1 }, (_, index) => index * 1000);
  if (remainderMeters >= minPartialMeters) boundaries.push(totalDistance);

  const splits: KilometreSplit[] = [];
  for (let i = 1; i < boundaries.length; i += 1) {
    const startMeters = boundaries[i - 1];
    const endMeters = boundaries[i];
    const start = boundaryAtDistance(points, startMeters);
    const end = boundaryAtDistance(points, endMeters);
    if (!start || !end) continue;

    const distanceMeters = endMeters - startMeters;
    const durationSeconds = end.elapsed - start.elapsed;
    if (distanceMeters <= 0 || durationSeconds <= 0) continue;

    const paceSecondsPerKm = durationSeconds / (distanceMeters / 1000);
    if (!Number.isFinite(paceSecondsPerKm) || paceSecondsPerKm <= 0) continue;

    const isPartial = distanceMeters < 999.5;
    const previous = splits.at(-1);
    splits.push({
      id: `km-split-${i}`,
      label: isPartial ? (distanceMeters / 1000).toFixed(2) : String(i),
      distanceMeters,
      durationSeconds,
      paceSecondsPerKm,
      deltaSeconds: previous ? previous.paceSecondsPerKm - paceSecondsPerKm : null,
      startIndex: start.index,
      endIndex: end.index,
    });
  }

  return splits;
}
