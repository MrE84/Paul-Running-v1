import assert from "node:assert/strict";
import test from "node:test";
import type { WorkoutRevision, WorkoutStep } from "../domain/contracts";
import { INTERVALS_ICU_DELIVERY_PROFILE } from "../integrations/intervals-icu/translation";
import { validateWorkoutForSync } from "../qa";
import { summarizeWorkout } from "./summary";
import { advancedLunchWalkSteps, CHELTENHAM_RACE_CENTER_SECONDS, RACE_WEEK_2026 } from "./race-week";

function assertAutomatic(steps: WorkoutStep[]) {
  for (const step of steps) {
    if (step.kind === "repeat") {
      assertAutomatic(step.children);
    } else {
      assert.notEqual(step.durationType, "open");
      assert.equal(step.manualLapIntent, undefined);
    }
  }
}

function asRevision(index: number): WorkoutRevision {
  const definition = RACE_WEEK_2026[index];
  assert.ok(definition);
  return {
    workoutId: definition.key,
    version: 1,
    name: definition.name,
    description: definition.description,
    sport: definition.sport,
    steps: definition.steps,
    createdAt: "2026-09-12T14:00:00.000Z",
    createdByActor: "system",
  };
}

test("race-week control-surface fixtures are Garmin-safe and omit Wednesday", () => {
  assert.deepEqual(RACE_WEEK_2026.map((item) => item.dayOffset), [0, 5, 6]);
  assert.deepEqual(RACE_WEEK_2026.map((item) => item.localStartTime), ["17:30", "17:00", "09:00"]);

  RACE_WEEK_2026.forEach((definition, index) => {
    assertAutomatic(definition.steps);
    const report = validateWorkoutForSync({
      workout: asRevision(index),
      context: { deliveryProfile: INTERVALS_ICU_DELIVERY_PROFILE },
    });
    assert.equal(report.valid, true, `${definition.name}: ${JSON.stringify(report.findings)}`);
  });
});

test("route-aware race fixture is 21.1 km and centres exactly on 1:50:00", () => {
  const summary = summarizeWorkout(asRevision(2));
  assert.equal(summary.totalDistanceMeters?.min, 21100);
  assert.equal(summary.totalDistanceMeters?.max, 21100);
  assert.equal(CHELTENHAM_RACE_CENTER_SECONDS, 6600);
});

test("advanced lunch walk remains five automatic two-minute steps", () => {
  const steps = advancedLunchWalkSteps();
  assert.equal(steps.length, 5);
  assertAutomatic(steps);
  for (const step of steps) {
    assert.equal(step.kind, "step");
    if (step.kind === "step") {
      assert.equal(step.durationType, "time");
      assert.equal(step.durationValue, 120);
      assert.equal(step.targetType, "none");
    }
  }
});
