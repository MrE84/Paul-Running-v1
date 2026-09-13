import assert from "node:assert/strict";
import test from "node:test";
import type { WorkoutRevision, ZoneSet } from "../domain/contracts";
import {
  bestEfforts,
  buildActivityIntelligence,
  densityHeatmap,
  derivedRunningMetrics,
  efficiencyAnalysis,
  histogram,
  plannedIntervals,
  peakSignalEfforts,
  scatterSamples,
  zoneDistribution,
} from "./intelligence";
import { projectActivity } from "./projection";
import { sampleFit } from "./sample";
import { applyWeatherChannels, fetchHistoricalWeather, travelBearing, windComponents } from "./weather";

const source = { id: "batch-b-run", name: "batch-b.fit", origin: "browser" as const };
const heartRateZones: ZoneSet = {
  id: "hr-zones",
  athleteId: "athlete-1",
  sport: "running",
  targetType: "heart_rate",
  name: "Running HR",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  source: "test",
  createdAt: "2026-01-01T00:00:00.000Z",
  zones: [
    { id: "z1", zoneNumber: 1, name: "Easy", lowerBound: 0, upperBound: 144, unit: "bpm" },
    { id: "z2", zoneNumber: 2, name: "Steady", lowerBound: 145, upperBound: 164, unit: "bpm" },
    { id: "z3", zoneNumber: 3, name: "Threshold", lowerBound: 165, upperBound: 198, unit: "bpm" },
  ],
};

const workout: WorkoutRevision = {
  workoutId: "workout-1",
  version: 2,
  name: "Progression",
  sport: "running",
  createdAt: "2026-09-12T07:00:00.000Z",
  createdByActor: "user",
  steps: [
    { id: "warmup", kind: "step", sequence: 0, phase: "warmup", name: "Warm up", durationType: "time", durationValue: 60, durationUnit: "seconds", targetType: "none" },
    { id: "work", kind: "step", sequence: 1, phase: "active", name: "Work", durationType: "distance", durationValue: 400, durationUnit: "meters", targetType: "heart_rate", targetLow: 135, targetHigh: 170, targetUnit: "bpm" },
    { id: "finish", kind: "step", sequence: 2, phase: "cooldown", name: "Cool down", durationType: "time", durationValue: 60, durationUnit: "seconds", targetType: "none" },
  ],
};

function projection(seconds = 900) {
  return projectActivity(source, sampleFit(seconds), {
    id: source.id,
    title: "Batch B progression",
    sport: "running",
    startedAt: "2026-09-12T08:00:00.000Z",
    distance: null,
    duration: seconds,
    calendarItemId: "calendar-1",
  }, [heartRateZones]);
}

test("Batch B intelligence remains deterministic and versioned", () => {
  const activity = projection();
  const before = JSON.stringify(activity);
  const first = buildActivityIntelligence(activity, workout);
  const second = buildActivityIntelligence(activity, workout);
  assert.equal(first.version, "1.1.0");
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(activity), before);
  assert.equal(first.plannedActual?.workoutId, workout.workoutId);
});

test("recorded, detected and planned intervals share projection indices", () => {
  const activity = projection(1200);
  const intelligence = buildActivityIntelligence(activity, workout);
  assert.ok(intelligence.intervals.some(interval => interval.source === "recorded"));
  assert.ok(intelligence.intervals.some(interval => interval.source === "detected"));
  const planned = plannedIntervals(activity, workout);
  assert.equal(planned.length, 3);
  assert.equal(planned[1].target?.channel, "heart_rate");
  assert.ok(planned.every(interval => interval.start <= interval.end));
  assert.ok(planned[1].compliancePercent !== null);
});

test("time-weighted zones classify activity time without double counting", () => {
  const activity = projection();
  const distribution = zoneDistribution(activity, "heart_rate");
  assert.ok(distribution);
  assert.ok(distribution.totalSeconds > 0);
  assert.ok(distribution.classifiedSeconds <= distribution.totalSeconds);
  const total = distribution.zones.reduce((sum, zone) => sum + zone.percentage, 0)
    + 100 * distribution.unclassifiedSeconds / distribution.totalSeconds;
  assert.ok(Math.abs(total - 100) < 0.001);
});

test("histogram and scatter builders use only available selected-range samples", () => {
  const activity = projection();
  const bins = histogram(activity, "heart_rate", [100, 500], 10);
  assert.equal(bins.length, 10);
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 401);
  const scatter = scatterSamples(activity, "heart_rate", "pace", [100, 500], 80);
  assert.ok(scatter.length > 0 && scatter.length <= 80);
  assert.ok(scatter.every(sample => sample.index >= 100 && sample.index <= 500));
  const heatmap = densityHeatmap(scatter);
  assert.equal(heatmap.reduce((sum, cell) => sum + cell.count, 0), scatter.length);
  assert.ok(heatmap.every(cell => cell.indices.length === cell.count));
});

test("best efforts expose rolling time and distance windows with source ranges", () => {
  const efforts = bestEfforts(projection(3600));
  assert.ok(efforts.some(effort => effort.id === "time-300"));
  assert.ok(efforts.some(effort => effort.id === "distance-5000"));
  assert.ok(efforts.every(effort => effort.averageSpeedMps > 0 && effort.end > effort.start));
});

test("efficiency reports speed-to-HR drift for whole and selected ranges", () => {
  const activity = projection(1800);
  const whole = efficiencyAnalysis(activity);
  const selected = efficiencyAnalysis(activity, [300, 1200]);
  assert.ok(whole?.speedPerHeartBeat);
  assert.ok(Number.isFinite(whole?.aerobicDecouplingPercent));
  assert.deepEqual(selected?.range, [300, 1200]);
  assert.equal(efficiencyAnalysis(activity, [300, 300]), null);
  assert.equal(efficiencyAnalysis(activity, [300, 301]), null);
});

test("terrain, internal load and peak signals are transparent and range-aware", () => {
  const activity = projection(1800);
  const full = derivedRunningMetrics(activity);
  const selected = derivedRunningMetrics(activity, [300, 900]);
  assert.ok(full.gradeAdjustedPaceSecPerKm);
  assert.ok(full.internalLoadScore !== null && full.internalLoadScore > 0);
  assert.match(full.loadFormula, /zone seconds/);
  assert.deepEqual(selected.range, [300, 900]);
  const peaks = peakSignalEfforts(activity);
  assert.ok(peaks.some(effort => effort.channel === "heart_rate" && effort.windowSeconds === 300));
  assert.ok(peaks.every(effort => effort.end > effort.start && Number.isFinite(effort.average)));
});

test("route bearings and wind components distinguish headwind from crosswind", () => {
  assert.ok(Math.abs(travelBearing({ latitude: 51, longitude: 0 }, { latitude: 51, longitude: 1 }) - 89.6) < 1);
  const headwind = windComponents(8, 90, 90);
  assert.ok(Math.abs(headwind.headwindMps - 8) < 0.001);
  assert.ok(Math.abs(headwind.crosswindMps) < 0.001);
  const crosswind = windComponents(8, 180, 90);
  assert.ok(Math.abs(crosswind.headwindMps) < 0.001);
  assert.ok(Math.abs(crosswind.crosswindMps - 8) < 0.001);
});

test("historical route weather is versioned and projected into separate ambient channels", async () => {
  const activity = projection(600);
  const fetchImpl = async () => new Response(JSON.stringify({
    hourly: {
      time: ["2026-09-12T08:00", "2026-09-12T09:00"],
      temperature_2m: [14, 15], apparent_temperature: [13, 14], relative_humidity_2m: [72, 68],
      dew_point_2m: [9, 9], precipitation: [0.1, 0.2], surface_pressure: [1008, 1009],
      cloud_cover: [60, 50], wind_speed_10m: [4, 5], wind_gusts_10m: [7, 8], wind_direction_10m: [180, 190],
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const weather = await fetchHistoricalWeather(activity, fetchImpl as typeof fetch);
  assert.equal(weather.status, "available");
  assert.ok(weather.samples.length > 1);
  assert.equal(weather.summary.temperatureC, 14);
  assert.ok(Math.abs((weather.summary.precipitationMm ?? 0) - 0.1) < 1e-9);
  const enriched = applyWeatherChannels(activity, weather);
  assert.equal(enriched.weather?.version, weather.version);
  assert.equal(enriched.streams.channels.ambient_temperature?.[0], 14);
  assert.notEqual(enriched.streams.channels.temperature, enriched.streams.channels.ambient_temperature);
  assert.equal(activity.weather, undefined);
});

test("weather enrichment degrades cleanly without GPS", async () => {
  const activity = projection(60);
  activity.streams.latitude.fill(null);
  activity.streams.longitude.fill(null);
  const weather = await fetchHistoricalWeather(activity, async () => { throw new Error("must not fetch"); });
  assert.equal(weather.status, "unavailable");
  assert.equal(weather.samples.length, 0);
});
