import assert from "node:assert/strict";
import test from "node:test";
import type { WorkoutRevision, WorkoutStep } from "../domain/contracts";
import { INTERVALS_ICU_DELIVERY_PROFILE } from "../integrations/intervals-icu/translation";
import { validateWorkoutForSync } from "../qa";
import { summarizeWorkout } from "./summary";
import { POST_HALF_RECOVERY_2026, POST_HALF_RECOVERY_START_DATE } from "./post-half-recovery";

function assertAutomatic(steps: WorkoutStep[]) {
  for (const step of steps) {
    if (step.kind === "repeat") {
      assertAutomatic(step.children);
    } else {
      assert.notEqual(step.durationType, "open");
      assert.equal(step.manualLapIntent, undefined);
      assert.equal(step.targetType, "none");
    }
  }
}

function asRevision(index: number): WorkoutRevision {
  const definition = POST_HALF_RECOVERY_2026[index];
  assert.ok(definition);
  return {
    workoutId: definition.key,
    version: 1,
    name: definition.name,
    description: definition.description,
    sport: definition.sport,
    steps: definition.steps,
    createdAt: "2026-09-13T19:30:00.000Z",
    createdByActor: "system",
  };
}

test("post-half recovery week starts Monday 21 Sep and keeps Tue Thu Sat clear", () => {
  assert.equal(POST_HALF_RECOVERY_START_DATE, "2026-09-21");
  assert.deepEqual(POST_HALF_RECOVERY_2026.map((item) => item.dayOffset), [0, 2, 4, 6]);
  assert.deepEqual(POST_HALF_RECOVERY_2026.map((item) => item.localStartTime), ["18:00", "18:00", "18:00", "09:00"]);
});

test("post-half recovery workouts are automatic Garmin-safe untargeted sessions", () => {
  POST_HALF_RECOVERY_2026.forEach((definition, index) => {
    assertAutomatic(definition.steps);
    const report = validateWorkoutForSync({
      workout: asRevision(index),
      context: { deliveryProfile: INTERVALS_ICU_DELIVERY_PROFILE },
    });
    assert.equal(report.valid, true, `${definition.name}: ${JSON.stringify(report.findings)}`);
  });
});

test("post-half recovery durations stay deliberately conservative", () => {
  const durations = POST_HALF_RECOVERY_2026.map((_, index) => {
    const summary = summarizeWorkout(asRevision(index));
    return summary.totalDurationSeconds?.min;
  });
  assert.deepEqual(durations, [1800, 1500, 1800, 2700]);
});
