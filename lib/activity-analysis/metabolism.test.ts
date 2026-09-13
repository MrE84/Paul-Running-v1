import assert from "node:assert/strict";
import test from "node:test";
import { estimateFatOxidation, fatOxidationRateForHeartRate } from "./metabolism";

test("interpolates the athlete-specific HR fat oxidation model", () => {
  const at135 = fatOxidationRateForHeartRate(135);
  assert.ok(at135);
  assert.equal(at135.low, 0.45);
  assert.equal(at135.high, 0.60);

  const between = fatOxidationRateForHeartRate(137.5);
  assert.ok(between);
  assert.ok(between.low >= 0.45 && between.low <= 0.46);
  assert.ok(between.high > 0.60 && between.high < 0.65);
});

test("integrates sample-by-sample HR rather than whole-activity average only", () => {
  const estimate = estimateFatOxidation([0, 10, 20], [135, 140, 165]);
  assert.ok(estimate);
  assert.ok(estimate.grams > 0.1);
  assert.ok(estimate.gramsLow < estimate.grams);
  assert.ok(estimate.gramsHigh > estimate.grams);
  assert.equal(estimate.coverage, 1);
  assert.equal(estimate.lt1Bpm, 144);
  assert.equal(estimate.lt2Bpm, 165);
});

test("returns unavailable when no usable HR exists", () => {
  assert.equal(estimateFatOxidation([0, 10, 20], undefined), null);
  assert.equal(estimateFatOxidation([0, 10, 20], [null, null, null]), null);
});

test("excludes recording gaps instead of inventing metabolic load", () => {
  const estimate = estimateFatOxidation(
    [0, 10, 100, 110],
    [140, 140, 140, 140],
    { breakBefore: [false, false, true, false] },
  );
  assert.ok(estimate);
  assert.equal(estimate.coveredSeconds, 20);
  assert.ok(estimate.coverage < 0.2);
});

test("supports selected-range estimates", () => {
  const full = estimateFatOxidation([0, 10, 20, 30], [135, 135, 165, 165]);
  const selected = estimateFatOxidation([0, 10, 20, 30], [135, 135, 165, 165], { range: [0, 1] });
  assert.ok(full && selected);
  assert.ok(selected.grams < full.grams);
  assert.equal(selected.coveredSeconds, 10);
});
