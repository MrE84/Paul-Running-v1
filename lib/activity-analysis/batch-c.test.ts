import assert from "node:assert/strict";
import test from "node:test";
import type { ZoneSet } from "../domain/contracts";
import { buildActivityComparison } from "./comparison";
import { buildActivityIntelligence } from "./intelligence";
import { BUILT_IN_LAYOUTS, builtInLayout, moveLayoutCard, normalizeLayout } from "./layout";
import { projectActivity, type AnalysisProjection } from "./projection";
import { applyCorrectionLayers, buildCorrectionLayer, detectAnalysisAnomalies, performanceProfile, privacySafeGpx } from "./quality";
import { sampleFit } from "./sample";
import { buildAthleteTrends } from "./trends";

const zones: ZoneSet = {
  id: "batch-c-zones", athleteId: "athlete-1", sport: "running", targetType: "heart_rate", name: "Running HR",
  effectiveFrom: "2026-01-01T00:00:00.000Z", source: "test", createdAt: "2026-01-01T00:00:00.000Z",
  zones: [
    { id: "z1", zoneNumber: 1, name: "Easy", lowerBound: 80, upperBound: 144, unit: "bpm" },
    { id: "z2", zoneNumber: 2, name: "Steady", lowerBound: 145, upperBound: 164, unit: "bpm" },
    { id: "z3", zoneNumber: 3, name: "Threshold", lowerBound: 165, upperBound: 198, unit: "bpm" },
  ],
};

function activity(id: string, startedAt: string, seconds = 1200, speedMultiplier = 1): AnalysisProjection {
  const fit = sampleFit(seconds);
  const records = fit.records as Array<Record<string, unknown>>;
  for (const record of records) record.enhanced_speed = Number(record.enhanced_speed) * speedMultiplier;
  const session = (fit.sessions as Array<Record<string, unknown>>)[0];
  session.total_distance = Number(session.total_distance) * speedMultiplier;
  session.enhanced_avg_speed = Number(session.enhanced_avg_speed) * speedMultiplier;
  const projection = projectActivity({ id, name: `${id}.fit`, origin: "backend" }, fit, {
    id, title: id.replaceAll("-", " "), sport: "running", startedAt,
    distance: Number(session.total_distance), duration: seconds,
  }, [zones]);
  projection.intelligence = buildActivityIntelligence(projection);
  return projection;
}

test("Batch C comparison aligns 2–6 activities by time, distance and interval without mutation", () => {
  const first = activity("first-run", "2026-08-01T08:00:00.000Z");
  const second = activity("second-run", "2026-08-08T08:00:00.000Z", 1200, 1.08);
  const before = JSON.stringify([first, second]);
  const time = buildActivityComparison([first, second], { alignment: "time", channels: ["heart_rate", "pace"], shifts: { "second-run": -5 } });
  const distance = buildActivityComparison([first, second], { alignment: "distance", channels: ["heart_rate"], relative: true });
  const interval = buildActivityComparison([first, second], { alignment: "interval", channels: ["pace"], intervalLabel: "Lap 1" });
  assert.equal(time.series.length, 2);
  assert.equal(time.series[1].points[0].x, -5);
  assert.equal(distance.xUnit, "meters");
  assert.ok(distance.series[0].points.filter(point => point.values.heart_rate !== null).every(point => Math.abs(point.values.heart_rate!) < 1e-8));
  assert.equal(interval.summaries[0].intervalLabel, "Lap 1");
  assert.ok(interval.summaries.every(item => item.durationSeconds <= 600));
  assert.ok(interval.summaries.every(item => item.heartRateZones.length > 0));
  assert.equal(JSON.stringify([first, second]), before);
});

test("comparison rejects duplicate activities and keeps source indices after reduction", () => {
  const projection = activity("same", "2026-08-01T08:00:00.000Z", 3600);
  assert.throws(() => buildActivityComparison([projection, projection], { alignment: "time", channels: ["pace"] }), /unique/);
  const other = activity("other", "2026-08-02T08:00:00.000Z", 3600);
  const reduced = buildActivityComparison([projection, other], { alignment: "time", channels: ["heart_rate", "pace"], maxPoints: 220 });
  assert.ok(reduced.series.every(series => series.points.length < projection.streams.elapsed.length));
  assert.ok(reduced.series.every(series => series.points.every(point => Number.isInteger(point.index))));
});

test("longitudinal dashboard aggregates periods, load/form, efficiency and PB progression deterministically", () => {
  const activities = [
    activity("run-1", "2026-08-03T08:00:00.000Z", 2000, .96),
    activity("run-2", "2026-08-10T08:00:00.000Z", 2000, 1),
    activity("run-3", "2026-08-17T08:00:00.000Z", 2000, 1.05),
    activity("run-4", "2026-08-24T08:00:00.000Z", 2000, 1.1),
  ].map((projection, index) => ({ projection, equipment: [index < 2 ? "Evo SL" : "Rocket X 3"] }));
  const first = buildAthleteTrends(activities, { bucket: "week", fitnessTimeConstantDays: 42, fatigueTimeConstantDays: 7 });
  const second = buildAthleteTrends(activities, { bucket: "week", fitnessTimeConstantDays: 42, fatigueTimeConstantDays: 7 });
  assert.deepEqual(first, second);
  assert.equal(first.totals.activities, 4);
  assert.equal(first.volume.length, 4);
  assert.ok(first.load.length >= 22);
  assert.ok(first.load.some(point => point.load > 0));
  assert.equal(first.equipment.length, 2);
  assert.ok(first.personalBests.some(point => point.distanceMeters === 5000));
  assert.equal(first.fitnessAnswer.direction, "improving");
  assert.match(first.algorithms.fitnessFatigueForm, /42d.*7d/);
});

test("trend filters and empty history degrade locally", () => {
  const run = activity("run", "2026-08-03T08:00:00.000Z");
  const empty = buildAthleteTrends([{ projection: run }], { from: "2026-09-01", sport: "cycling" });
  assert.equal(empty.totals.activities, 0);
  assert.equal(empty.load.length, 0);
  assert.equal(empty.fitnessAnswer.direction, "insufficient_data");
});

test("layout presets are bounded, restorable and preserve card order without arbitrary code", () => {
  assert.deepEqual(BUILT_IN_LAYOUTS.map(layout => layout.name), ["Run Overview", "Threshold Analysis", "Interval Analysis", "Long Run", "Race Review", "Raw / Dynamics"]);
  const preset = builtInLayout("threshold-analysis", "running");
  const normalized = normalizeLayout({ ...preset, name: "My threshold", channels: ["heart_rate", "unknown"], smoothingSeconds: 999, arbitraryCode: "alert(1)" }, "running", ["heart_rate", "pace"]);
  assert.deepEqual(normalized.channels, ["heart_rate"]);
  assert.equal(normalized.smoothingSeconds, 5);
  assert.equal("arbitraryCode" in normalized, false);
  const moved = moveLayoutCard(normalized, "zones", -1);
  assert.notDeepEqual(moved.cards.map(card => card.id), normalized.cards.map(card => card.id));
  assert.equal(normalized.cards.find(card => card.id === "zones")?.visible, true);
  const cycling = normalizeLayout(null, "cycling", ["heart_rate", "speed", "cadence", "power"]);
  assert.equal(cycling.name, "Cycling Overview");
  assert.deepEqual(cycling.channels, ["heart_rate", "speed", "cadence", "power"]);
});

test("anomaly correction is non-destructive and records provenance", () => {
  const projection = activity("spike-run", "2026-08-03T08:00:00.000Z", 300);
  projection.streams.channels.heart_rate![100] = 400;
  const before = JSON.stringify(projection);
  const anomalies = detectAnalysisAnomalies(projection);
  assert.ok(anomalies.some(item => item.channel === "heart_rate" && item.index === 100 && item.kind === "range"));
  const layer = buildCorrectionLayer(projection, "heart_rate", anomalies);
  const corrected = applyCorrectionLayers(projection, [layer]);
  assert.notEqual(corrected.streams.channels.heart_rate![100], 400);
  assert.equal(projection.streams.channels.heart_rate![100], 400);
  assert.equal(JSON.stringify(projection), before);
  assert.match(corrected.provenance.algorithms["correction:heart_rate"], /non-destructive/);
});

test("privacy-safe GPX shares the map mask and performance profile scales large files", () => {
  const projection = activity("route-run", "2026-08-03T08:00:00.000Z", 600);
  const firstLat = projection.streams.latitude.find(value => value !== null)!;
  const firstLon = projection.streams.longitude.find(value => value !== null)!;
  const gpx = privacySafeGpx(projection, 250);
  assert.match(gpx, /<gpx.*<trk>/);
  assert.doesNotMatch(gpx, new RegExp(`lat="${firstLat.toFixed(6)}" lon="${firstLon.toFixed(6)}"`));
  assert.equal(projection.streams.latitude[0], firstLat);
  const profile = performanceProfile({ ...projection, streams: { ...projection.streams, elapsed: Array.from({ length: 25_000 }, (_, index) => index) } });
  assert.equal(profile.largeActivity, true);
  assert.ok(profile.reductionRatio < .1);
});

test("quality analysis handles treadmill and missing-channel fixtures without failing the activity", () => {
  const treadmill = activity("treadmill", "2026-08-03T08:00:00.000Z", 300);
  treadmill.streams.latitude.fill(null);
  treadmill.streams.longitude.fill(null);
  delete treadmill.streams.channels.power;
  assert.doesNotThrow(() => detectAnalysisAnomalies(treadmill));
  assert.equal(privacySafeGpx(treadmill, 200).includes("<trkseg>"), false);
});
