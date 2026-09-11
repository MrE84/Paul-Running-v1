import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkout,
  cadenceTarget,
  distanceDuration,
  heartRateTarget,
  manualLapDuration,
  noTarget,
  paceTarget,
  powerTarget,
  repeat,
  step,
  timeDuration,
} from "./builder";
import {
  easyRunPreset,
  intervalPreset,
  longRunPreset,
  stridesPreset,
  thresholdPreset,
} from "./presets";

function ids() {
  let value = 0;
  return () => `id-${++value}`;
}

const base = {
  workoutId: "workout-1",
  version: 1,
  name: "Test workout",
  createdAt: "2026-09-11T09:00:00.000Z",
  createdByActor: "user" as const,
};

test("builder encodes time, distance and intentional manual-Lap steps with all target types", () => {
  const result = buildWorkout(
    {
      ...base,
      steps: [
        step("warmup", timeDuration(600), heartRateTarget(120, 140), { name: "Warm-up" }),
        step("active", distanceDuration(1000), paceTarget(300, 310), { name: "1 km" }),
        step("recovery", manualLapDuration(), noTarget(), { name: "Lap when ready" }),
        step("active", timeDuration(20), cadenceTarget(180, 185), { name: "Stride" }),
        step("cooldown", timeDuration(300), powerTarget(180, 220), { name: "Cool-down" }),
      ],
    },
    { idFactory: ids() },
  );

  assert.equal(result.workout.steps.length, 5);
  const [warmup, active, recovery, cadence, power] = result.workout.steps;
  assert.equal(warmup.kind, "step");
  assert.equal(active.kind, "step");
  assert.equal(recovery.kind, "step");
  assert.equal(cadence.kind, "step");
  assert.equal(power.kind, "step");

  if (
    warmup.kind !== "step" ||
    active.kind !== "step" ||
    recovery.kind !== "step" ||
    cadence.kind !== "step" ||
    power.kind !== "step"
  ) {
    throw new Error("Expected executable steps.");
  }

  assert.equal(warmup.phase, "warmup");
  assert.equal(warmup.durationType, "time");
  assert.equal(warmup.durationUnit, "seconds");
  assert.equal(warmup.targetType, "heart_rate");
  assert.equal(warmup.targetUnit, "bpm");

  assert.equal(active.durationType, "distance");
  assert.equal(active.durationUnit, "meters");
  assert.equal(active.targetType, "pace");
  assert.equal(active.targetUnit, "sec_per_km");

  assert.equal(recovery.durationType, "open");
  assert.equal(recovery.durationValue, undefined);
  assert.equal(recovery.targetType, "none");

  assert.equal(cadence.targetType, "cadence");
  assert.equal(cadence.targetUnit, "spm");
  assert.equal(power.targetType, "power");
  assert.equal(power.targetUnit, "watts");
});

test("builder preserves nested repeat blocks and deterministic sequence ordering", () => {
  const result = buildWorkout(
    {
      ...base,
      steps: [
        step("warmup", timeDuration(600), noTarget()),
        repeat(
          4,
          [
            step("active", distanceDuration(800), paceTarget(290, 300)),
            step("recovery", distanceDuration(400), paceTarget(390, 420)),
          ],
          { name: "4 x 800 m" },
        ),
        step("cooldown", timeDuration(600), noTarget()),
      ],
    },
    { idFactory: ids() },
  );

  assert.deepEqual(result.workout.steps.map((item) => item.sequence), [0, 1, 2]);
  const block = result.workout.steps[1];
  assert.equal(block.kind, "repeat");
  if (block.kind !== "repeat") throw new Error("Expected repeat block.");
  assert.equal(block.repeatCount, 4);
  assert.deepEqual(block.children.map((item) => item.sequence), [0, 1]);
  assert.equal(result.summary.executionStepCount, 10);
  assert.equal(result.summary.repeatBlockCount, 1);
});

test("summary calculates total duration and distance where pace makes both dimensions determinable", () => {
  const result = buildWorkout(
    {
      ...base,
      steps: [
        step("active", distanceDuration(1000), paceTarget(300)),
        step("active", timeDuration(600), paceTarget(360)),
        repeat(2, [step("active", distanceDuration(400), paceTarget(240))]),
      ],
    },
    { idFactory: ids() },
  );

  assert.ok(result.summary.totalDurationSeconds);
  assert.ok(result.summary.totalDistanceMeters);
  assert.equal(result.summary.totalDurationSeconds?.exact, true);
  assert.equal(result.summary.totalDistanceMeters?.exact, true);
  assert.equal(result.summary.totalDurationSeconds?.min, 1092);
  assert.ok(Math.abs((result.summary.totalDistanceMeters?.min ?? 0) - 3466.6666666666665) < 1e-6);
});

test("manual-Lap/open steps keep known totals but correctly make full totals indeterminate", () => {
  const result = buildWorkout(
    {
      ...base,
      steps: [
        step("warmup", timeDuration(600), noTarget()),
        step("active", distanceDuration(1000), paceTarget(300)),
        step("recovery", manualLapDuration(), noTarget()),
      ],
    },
    { idFactory: ids() },
  );

  assert.equal(result.summary.openStepCount, 1);
  assert.equal(result.summary.knownDurationSeconds, 900);
  assert.equal(result.summary.knownDistanceMeters, 1000);
  assert.equal(result.summary.totalDurationSeconds, undefined);
  assert.equal(result.summary.totalDistanceMeters, undefined);
});

test("presets cover easy, long, threshold, interval and strides session families", () => {
  const easy = easyRunPreset({ durationSeconds: 2400, target: heartRateTarget(120, 140) });
  const long = longRunPreset({ durationSeconds: 5400, target: heartRateTarget(120, 145) });
  const threshold = thresholdPreset({
    warmupSeconds: 900,
    repetitions: 3,
    workSeconds: 600,
    recoverySeconds: 120,
    thresholdTarget: heartRateTarget(158, 165),
    cooldownSeconds: 600,
  });
  const intervals = intervalPreset({
    warmupSeconds: 900,
    repetitions: 5,
    workMeters: 800,
    workTarget: paceTarget(285, 300),
    recoveryMeters: 400,
    recoveryTarget: paceTarget(390, 420),
    cooldownSeconds: 600,
  });
  const strides = stridesPreset({
    warmupSeconds: 1200,
    repetitions: 4,
    strideSeconds: 20,
    recoverySeconds: 80,
    cadenceSpm: 180,
    cooldownSeconds: 300,
  });

  for (const preset of [easy, long, threshold, intervals, strides]) {
    const built = buildWorkout(
      { ...base, name: preset.name, steps: preset.steps },
      { idFactory: ids() },
    );
    assert.ok(built.workout.steps.length > 0);
  }

  assert.equal(threshold.steps[1]?.kind, "repeat");
  assert.equal(intervals.steps[1]?.kind, "repeat");
  assert.equal(strides.steps[1]?.kind, "repeat");
});

test("builder rejects invalid duration, target and repeat inputs before a workout is created", () => {
  assert.throws(
    () =>
      buildWorkout(
        { ...base, steps: [step("active", timeDuration(0), noTarget())] },
        { idFactory: ids() },
      ),
    /greater than zero/,
  );

  assert.throws(
    () =>
      buildWorkout(
        { ...base, steps: [step("active", timeDuration(60), paceTarget(360, 300))] },
        { idFactory: ids() },
      ),
    /upper bound cannot be lower/,
  );

  assert.throws(
    () =>
      buildWorkout(
        { ...base, steps: [repeat(0, [step("active", timeDuration(60), noTarget())])] },
        { idFactory: ids() },
      ),
    /positive integer/,
  );
});
