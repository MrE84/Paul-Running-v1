import assert from "node:assert/strict";
import test from "node:test";
import { projectActivity } from "./projection";
import { chartSamples, rangeSummary, routeSamples, smoothValues } from "./selection";
import { sampleFit } from "./sample";

const source = { id: "sample-run", name: "sample.fit", origin: "browser" as const };

test("Batch A projection is deterministic, versioned and does not mutate normalized FIT input", () => {
  const decoded = sampleFit(180);
  const before = JSON.stringify(decoded);
  const first = projectActivity(source, decoded);
  const second = projectActivity(source, decoded);
  assert.equal(first.version, "1.2.0");
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(decoded), before);
  assert.equal(first.quality.inputRecords, 181);
  assert.equal(first.streams.elapsed.length, first.quality.samples);
  assert.ok(first.streams.channels.heart_rate);
  assert.ok(first.streams.channels.pace);
  assert.ok(first.derived.bestEfforts.version);
});

test("missing optional streams degrade cleanly for indoor activities", () => {
  const projection = projectActivity(source, {
    sessions: [{ sport: "running", total_elapsed_time: 2, total_timer_time: 2 }],
    records: [
      { elapsed_time: 0, heart_rate: 140 },
      { elapsed_time: 1, heart_rate: 141 },
      { elapsed_time: 2, heart_rate: 142 },
    ],
  });
  assert.ok(projection.streams.channels.heart_rate);
  assert.equal(projection.streams.latitude.every(value => value === null), true);
  assert.ok(projection.quality.flags.some(flag => flag.includes("No GPS")));
  assert.equal(routeSamples(projection, 0, []).length, 0);
});

test("shared range summary uses original aligned samples", () => {
  const projection = projectActivity(source, sampleFit(120));
  const selected = rangeSummary(projection, [20, 80]);
  assert.equal(selected.duration, 60);
  assert.ok(selected.distance !== null && selected.distance > 0);
  assert.ok(selected.means.heart_rate !== null);
  assert.ok(selected.means.pace !== null);
});

test("display smoothing preserves nulls and recording breaks", () => {
  const values = [100, 110, null, 140, 150];
  const elapsed = [0, 1, 2, 40, 41];
  const breaks = [false, false, false, true, false];
  const smoothed = smoothValues(values, elapsed, breaks, 15);
  assert.equal(smoothed[2], null);
  assert.equal(smoothed[3], 140);
  assert.equal(smoothed[4], 145);
});

test("min/max downsampling retains source indices and extreme samples", () => {
  const projection = projectActivity(source, sampleFit(1200));
  const heartRate = projection.streams.channels.heart_rate!;
  heartRate[601] = 240;
  const chart = chartSamples(projection, ["heart_rate", "pace"], "time", 120, 0, "metric");
  assert.ok(chart.indices.length <= 200);
  assert.ok(chart.indices.includes(601), "extreme HR sample must survive display downsampling");
  assert.equal(chart.data.length, 3);
});

test("route privacy masks endpoints without changing the source stream", () => {
  const projection = projectActivity(source, sampleFit(300));
  const full = routeSamples(projection, 0, [], 10_000);
  const masked = routeSamples(projection, 200, [], 10_000);
  assert.ok(full.length > 2);
  assert.ok(masked.length < full.length);
  assert.equal(projection.streams.latitude.filter(value => value !== null).length, 301);
  assert.equal(masked.some(point => point.index === full[0].index), false);
  assert.equal(masked.some(point => point.index === full.at(-1)!.index), false);
});
