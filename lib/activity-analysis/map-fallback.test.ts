import assert from "node:assert/strict";
import test from "node:test";
import { osmTileLayout, projectRoutePaths, resolveRunnerPosition } from "./map-fallback";

test("projects route segments into visible SVG paths without MapLibre sources", () => {
  const paths = projectRoutePaths([
    { lat: 51.938265, lon: -2.066009, segment: 0 },
    { lat: 51.938525, lon: -2.066014, segment: 0 },
    { lat: 51.938548, lon: -2.065968, segment: 0 },
    { lat: 51.938552, lon: -2.065876, segment: 1 },
    { lat: 51.938542, lon: -2.065821, segment: 1 },
  ], (longitude, latitude) => ({ x: (longitude + 3) * 1000, y: (52 - latitude) * 1000 }));

  assert.equal(paths.length, 2);
  assert.match(paths[0].d, /^M/);
  assert.match(paths[0].d, / L/);
  assert.ok(paths.every(path => !path.d.includes("NaN")));
});

test("interpolates the runner between sparse GPS samples while chart scrubbing", () => {
  const points = [
    { index: 0, lat: 51.938, lon: -2.066, segment: 0 },
    { index: 10, lat: 51.938, lon: -2.064, segment: 0 },
  ];
  const elapsed = Array.from({ length: 11 }, (_, index) => index * 2);
  const runner = resolveRunnerPosition(points, 5, elapsed);

  assert.ok(runner);
  assert.equal(runner.index, 5);
  assert.ok(Math.abs(runner.lat - 51.938) < 1e-9);
  assert.ok(Math.abs(runner.lon - -2.065) < 1e-9);
  assert.ok(runner.bearing > 80 && runner.bearing < 100);
});

test("does not animate the runner across a privacy or GPS segment break", () => {
  const runner = resolveRunnerPosition([
    { index: 0, lat: 51.938, lon: -2.066, segment: 0 },
    { index: 10, lat: 51.939, lon: -2.065, segment: 1 },
  ], 5, Array.from({ length: 11 }, (_, index) => index));

  assert.equal(runner, null);
});

test("orients an exact GPS runner sample using adjacent travel direction", () => {
  const runner = resolveRunnerPosition([
    { index: 0, lat: 51.938, lon: -2.066, segment: 0 },
    { index: 5, lat: 51.939, lon: -2.066, segment: 0 },
    { index: 10, lat: 51.940, lon: -2.066, segment: 0 },
  ], 5);

  assert.ok(runner);
  assert.ok(runner.bearing < 5 || runner.bearing > 355);
});

test("builds direct OpenStreetMap DOM tiles around a Cheltenham viewport", () => {
  const tiles = osmTileLayout({
    longitude: -2.066,
    latitude: 51.9385,
    zoom: 13.4,
    width: 420,
    height: 440,
  });

  assert.ok(tiles.length >= 9);
  assert.ok(tiles.every(tile => tile.url.startsWith("https://tile.openstreetmap.org/13/")));
  assert.ok(tiles.every(tile => Number.isFinite(tile.left) && Number.isFinite(tile.top) && tile.size > 256));
});
