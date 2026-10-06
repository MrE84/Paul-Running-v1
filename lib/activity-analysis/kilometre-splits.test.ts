import assert from "node:assert/strict";
import test from "node:test";
import { buildKilometreSplits } from "./kilometre-splits";
import type { AnalysisProjection } from "./projection";

function projection(elapsed: number[], distance: Array<number | null>) {
  return { streams: { elapsed, distance } } as AnalysisProjection;
}

test("builds full kilometres plus a final partial split from the distance trace", () => {
  const splits = buildKilometreSplits(projection(
    [0, 150, 300, 465, 630, 720],
    [0, 500, 1000, 1500, 2000, 2500],
  ));

  assert.equal(splits.length, 3);
  assert.equal(splits[0].label, "1");
  assert.equal(Math.round(splits[0].paceSecondsPerKm), 300);
  assert.equal(splits[1].label, "2");
  assert.equal(Math.round(splits[1].paceSecondsPerKm), 330);
  assert.equal(Math.round(splits[1].deltaSeconds!), -30);
  assert.equal(splits[2].label, "0.50");
  assert.equal(Math.round(splits[2].paceSecondsPerKm), 180);
  assert.equal(Math.round(splits[2].deltaSeconds!), 150);
});

test("interpolates a kilometre boundary between recorded samples", () => {
  const splits = buildKilometreSplits(projection(
    [0, 180, 360, 540],
    [0, 600, 1200, 1800],
  ));

  assert.equal(splits.length, 2);
  assert.equal(Math.round(splits[0].durationSeconds), 300);
  assert.equal(Math.round(splits[0].paceSecondsPerKm), 300);
  assert.equal(splits[1].label, "0.80");
});
