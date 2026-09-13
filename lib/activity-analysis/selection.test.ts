import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisProjection } from "./projection";
import { routeSamples } from "./selection";

function projection(overrides: Partial<AnalysisProjection["streams"]>): AnalysisProjection {
  const elapsed = overrides.elapsed ?? [0, 1, 2];
  const n = elapsed.length;
  return {
    version: "test",
    source: { id: "test", name: "test.fit", origin: "backend" },
    activity: { id: "test", title: "Test", sport: "running", startedAt: null, distance: null, duration: null },
    summary: { distance: null, duration: null, elapsed: elapsed.at(-1) ?? null, speed: null, heartRate: null, cadence: null, ascent: null, calories: null },
    streams: {
      elapsed,
      distance: overrides.distance ?? new Array(n).fill(null),
      latitude: overrides.latitude ?? new Array(n).fill(null),
      longitude: overrides.longitude ?? new Array(n).fill(null),
      recordIndex: overrides.recordIndex ?? Array.from({ length: n }, (_, i) => i),
      breakBefore: overrides.breakBefore ?? new Array(n).fill(false),
      channels: overrides.channels ?? {},
    },
    laps: [],
    zones: {},
    provenance: { sourceFields: [], algorithms: {} },
    quality: { flags: [], inputRecords: n, samples: n, missing: {} },
    derived: {
      intervals: { version: "1", status: "pending", sourceChannels: [] },
      zones: { version: "1", status: "pending", sourceChannels: [] },
      weather: { version: "1", status: "pending", sourceChannels: [] },
      bestEfforts: { version: "1", status: "pending", sourceChannels: [] },
      efficiency: { version: "1", status: "pending", sourceChannels: [] },
      plannedActual: { version: "1", status: "pending", sourceChannels: [] },
    },
  };
}

test("routeSamples keeps isolated missing GPS rows in one route segment", () => {
  const p = projection({
    elapsed: [0, 1, 2, 3, 4],
    latitude: [51.9, null, 51.9001, null, 51.9002],
    longitude: [-2.1, null, -2.1001, null, -2.1002],
    breakBefore: [false, false, false, false, false],
  });

  const points = routeSamples(p, 0, [], 2000);
  assert.equal(points.length, 3);
  assert.deepEqual(points.map(point => point.segment), [0, 0, 0]);
});

test("routeSamples still splits a genuine long GPS outage", () => {
  const p = projection({
    elapsed: [0, 1, 45, 46],
    latitude: [51.9, null, 51.901, 51.9011],
    longitude: [-2.1, null, -2.101, -2.1011],
    breakBefore: [false, false, false, false],
  });

  const points = routeSamples(p, 0, [], 2000);
  assert.deepEqual(points.map(point => point.segment), [0, 1, 1]);
});

test("routeSamples keeps privacy-masked sections disconnected", () => {
  const p = projection({
    elapsed: [0, 1, 2],
    latitude: [51.9, 51.901, 51.902],
    longitude: [-2.1, -2.1, -2.1],
    breakBefore: [false, false, false],
  });

  const points = routeSamples(p, 0, [{ latitude: 51.901, longitude: -2.1, radius: 30 }], 2000);
  assert.equal(points.length, 2);
  assert.deepEqual(points.map(point => point.segment), [0, 1]);
});
