import assert from "node:assert/strict";
import test from "node:test";
import {
  analyseDecodedFit,
  availableChartMetrics,
  buildChartSeries,
  buildRoute,
  buildSummary,
  extractGroups,
  rowsToCsv,
} from "./core";

const parsed = {
  protocolVersion: 2,
  profileVersion: 2110,
  sessions: [
    {
      sport: "running",
      sub_sport: "road",
      start_time: "2026-09-05T08:33:41.000Z",
      timestamp: "2026-09-05T09:00:41.000Z",
      total_timer_time: 1620,
      total_elapsed_time: 1650,
      total_distance: 5000,
      enhanced_avg_speed: 5000 / 1620,
      enhanced_max_speed: 4.2,
      avg_heart_rate: 154,
      max_heart_rate: 178,
      avg_cadence: 86,
      max_cadence: 96,
      total_ascent: 42,
      total_descent: 39,
      total_calories: 350,
    },
  ],
  laps: [
    { start_time: "2026-09-05T08:33:41.000Z", total_timer_time: 300, total_distance: 1000, avg_heart_rate: 148 },
    { start_time: "2026-09-05T08:38:41.000Z", total_timer_time: 295, total_distance: 1000, avg_heart_rate: 154 },
  ],
  records: [
    {
      timestamp: "2026-09-05T08:33:41.000Z",
      elapsed_time: 0,
      distance: 0,
      heart_rate: 140,
      enhanced_speed: 2.8,
      cadence: 84,
      position_lat: 618_000_000,
      position_long: -25_000_000,
    },
    {
      timestamp: "2026-09-05T08:38:41.000Z",
      elapsed_time: 300,
      distance: 1000,
      heart_rate: 155,
      enhanced_speed: 3.3,
      cadence: 88,
      position_lat: 618_020_000,
      position_long: -24_980_000,
    },
    {
      timestamp: "2026-09-05T08:43:41.000Z",
      elapsed_time: 600,
      distance: 2000,
      heart_rate: 162,
      enhanced_speed: 3.5,
      cadence: 90,
      position_lat: 618_040_000,
      position_long: -24_960_000,
    },
  ],
  device_infos: [{ manufacturer: "garmin", product_name: "fenix 5" }],
};

test("summary preserves FIT Explorer running metrics and doubles running cadence", () => {
  const summary = buildSummary(parsed);
  assert.equal(summary.distance, 5000);
  assert.equal(summary.timerTime, 1620);
  assert.equal(summary.avgCadence, 172);
  assert.equal(summary.maxCadence, 192);
  assert.equal(summary.lapCount, 2);
  assert.equal(summary.recordCount, 3);
  assert.ok(summary.recordFields.includes("heart_rate"));
});

test("raw decoded sections and route points remain available", () => {
  const groups = extractGroups(parsed);
  assert.equal(groups[0].key, "sessions");
  assert.ok(groups.some((group) => group.key === "records" && group.count === 3));
  assert.ok(groups.some((group) => group.key === "device_infos"));

  const route = buildRoute(parsed);
  assert.equal(route.length, 3);
  assert.ok(route[0].lat > 50 && route[0].lat < 55);
  assert.ok(route[0].lon < 0);
});

test("chart series exposes the source explorer metric families with unit-safe pace", () => {
  const available = availableChartMetrics(parsed.records);
  assert.ok(available.some((metric) => metric.key === "heart_rate"));
  assert.ok(available.some((metric) => metric.key === "pace"));
  assert.ok(available.some((metric) => metric.key === "cadence"));

  const heartRate = buildChartSeries(parsed, "heart_rate", "metric");
  assert.deepEqual(heartRate.map((point) => point.y), [140, 155, 162]);
  assert.deepEqual(heartRate.map((point) => point.x), [0, 300, 600]);

  const pace = buildChartSeries(parsed, "pace", "metric");
  assert.ok(pace.every((point) => point.y > 200 && point.y < 400));
});

test("browser and backend sources converge on the same decoded analysis", () => {
  const browser = analyseDecodedFit({ id: "local", name: "run.fit", origin: "browser" }, parsed);
  const backend = analyseDecodedFit(
    { id: "activity-1", name: "run.fit", origin: "backend", externalId: "activity-1", sourceFileUrl: "/api/activity-1.fit" },
    parsed,
  );
  assert.deepEqual(browser.summary, backend.summary);
  assert.deepEqual(browser.records, backend.records);
  assert.deepEqual(browser.laps, backend.laps);
});

test("records and laps can still be exported as CSV", () => {
  const csv = rowsToCsv(parsed.laps);
  assert.match(csv, /start_time,total_timer_time,total_distance,avg_heart_rate/);
  assert.match(csv, /2026-09-05T08:33:41.000Z,300,1000,148/);
});
