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

test("routeSamples renders the changing degree coordinates reported in PAU-38", () => {
  const latitude = [
    51.9382652733475,
    51.93852477706969,
    51.93854841403663,
    51.93855159915984,
    51.938542295247316,
    51.9385034032166,
    51.93848378956318,
    51.93847071379423,
    51.938464092090726,
    51.938458140939474,
    51.93843886256218,
    51.938344314694405,
    51.93821934051812,
    51.93819587118924,
    51.93817407824099,
    51.93814977072179,
    51.93812387064099,
  ];
  const longitude = [
    -2.066009296104312,
    -2.0660135708749294,
    -2.065968392416835,
    -2.065876191481948,
    -2.0658212061971426,
    -2.065720623359084,
    -2.0657164324074984,
    -2.065714420750737,
    -2.065704111009836,
    -2.0656549092382193,
    -2.065695058554411,
    -2.065695896744728,
    -2.065713331103325,
    -2.065715342760086,
    -2.065706290304661,
    -2.065700925886631,
    -2.0656998362392187,
  ];
  const elapsed = [0, 4, 6, 9, 11, 15, 16, 17, 18, 22, 35, 40, 45, 46, 47, 48, 49];
  const p = projection({ latitude, longitude, elapsed, breakBefore: new Array(elapsed.length).fill(false) });

  const points = routeSamples(p, 0, [], 2000);
  assert.equal(points.length, latitude.length);
  assert.ok(points.every(point => point.segment === 0));
  assert.notDeepEqual([points[0].lat, points[0].lon], [points.at(-1)!.lat, points.at(-1)!.lon]);
});
