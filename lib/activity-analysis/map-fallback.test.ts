import assert from "node:assert/strict";
import test from "node:test";
import { osmTileLayout, projectRoutePaths } from "./map-fallback";

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
