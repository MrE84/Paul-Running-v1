import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_ANALYSIS_PROJECTION_VERSION,
  buildActivityAnalysisProjection,
  projectionCacheKey,
  selectProjectionRange,
  summarizeProjectionRange,
} from "./projection";

const decoded = {
  sessions: [{
    sport: "running",
    start_time: "2026-09-12T08:00:00.000Z",
    total_elapsed_time: 4,
    total_timer_time: 4,
    total_distance: 16,
    avg_heart_rate: 151,
    max_heart_rate: 157,
    enhanced_avg_speed: 4,
    avg_cadence: 86,
    total_ascent: 1,
  }],
  records: [
    { timestamp: "2026-09-12T08:00:00.000Z", distance: 0, enhanced_speed: 4, heart_rate: 148, cadence: 85, position_lat: 619000000, position_long: -22300000 },
    { timestamp: "2026-09-12T08:00:01.000Z", distance: 4, enhanced_speed: 4, heart_rate: 150, cadence: 86, position_lat: 619000200, position_long: -22300100 },
    { timestamp: "2026-09-12T08:00:02.000Z", distance: 8, enhanced_speed: 4.1, heart_rate: 151, cadence: 86, position_lat: 619000400, position_long: -22300200 },
    { timestamp: "2026-09-12T08:00:03.000Z", distance: 12, enhanced_speed: 4.2, heart_rate: 153, cadence: 87, position_lat: 619000600, position_long: -22300300 },
    { timestamp: "2026-09-12T08:00:04.000Z", distance: 16, enhanced_speed: 4.2, heart_rate: 157, cadence: 87, position_lat: 619000800, position_long: -22300400 },
  ],
  laps: [{ total_elapsed_time: 4, total_distance: 16, avg_heart_rate: 151, avg_speed: 4, avg_cadence: 86 }],
};

const browserSource = { id: "local-1", name: "test.fit", origin: "browser" as const };
const backendSource = { id: "activity-1", name: "test.fit", origin: "backend" as const, externalId: "i123" };

test("projection is deterministic and versioned", () => {
  const a = buildActivityAnalysisProjection(backendSource, decoded);
  const b = buildActivityAnalysisProjection(backendSource, decoded);
  assert.equal(a.projectionVersion, ACTIVITY_ANALYSIS_PROJECTION_VERSION);
  assert.deepEqual(a, b);
  assert.equal(a.generatedAt, null);
  assert.equal(projectionCacheKey("activity-1"), `activity-1:${a.projectionVersion}:${a.algorithmVersion}`);
});

test("browser and canonical sources share the same analysis stream shape", () => {
  const browser = buildActivityAnalysisProjection(browserSource, decoded);
  const canonical = buildActivityAnalysisProjection(backendSource, decoded);
  assert.deepEqual(browser.stream, canonical.stream);
  assert.deepEqual(browser.activity, canonical.activity);
  assert.deepEqual(browser.sourceChannels, canonical.sourceChannels);
  assert.equal(browser.stream[0].channels.cadenceSpm, 170);
  assert.equal(browser.stream[0].channels.paceSecondsPerKm, 250);
});

test("missing optional channels degrade cleanly", () => {
  const projection = buildActivityAnalysisProjection(browserSource, {
    sessions: [{ sport: "running", total_elapsed_time: 1 }],
    records: [{ timestamp: "2026-09-12T08:00:00.000Z", heart_rate: 140 }, { timestamp: "2026-09-12T08:00:01.000Z", heart_rate: 141 }],
  });
  assert.deepEqual(projection.sourceChannels, ["heartRateBpm"]);
  assert.equal(projection.derived.dataQuality.gpsPointCount, 0);
  assert.ok(projection.derived.dataQuality.missingChannels.includes("latitude"));
});

test("selection range powers linked summaries", () => {
  const projection = buildActivityAnalysisProjection(backendSource, decoded);
  const points = selectProjectionRange(projection, 1, 3);
  const summary = summarizeProjectionRange(points);
  assert.equal(points.length, 3);
  assert.equal(summary.elapsedSeconds, 2);
  assert.equal(summary.distanceMeters, 8);
  assert.equal(summary.avgHeartRateBpm, (150 + 151 + 153) / 3);
});
