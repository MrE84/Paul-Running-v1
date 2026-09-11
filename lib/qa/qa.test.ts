import assert from "node:assert/strict";
import test from "node:test";

import type {
  CapacityRevision,
  WorkoutExecutionStep,
  WorkoutRevision,
  ZoneSet,
} from "../domain/contracts";
import type { ScheduledCalendarItem } from "../calendar/contracts";
import {
  buildWorkout,
  distanceDuration,
  heartRateTarget,
  noTarget,
  paceTarget,
  repeat,
  step,
  timeDuration,
} from "../workouts";
import type { DeliveryProfile } from "./contracts";
import {
  assertWorkoutReadyForSync,
  calculatePaceArithmetic,
  validateWorkoutForSync,
  WorkoutQaError,
} from "./engine";

function ids() {
  let value = 0;
  return () => `qa-id-${++value}`;
}

const deliveryProfile: DeliveryProfile = {
  id: "garmin-fenix5-via-intervals",
  provider: "Intervals.icu → Garmin Fenix 5",
  supportedDurationTypes: ["time", "distance", "open"],
  supportedTargetTypes: ["none", "heart_rate", "pace", "cadence"],
  maxRepeatDepth: 1,
  maxExpandedExecutionSteps: 50,
  requireExplicitManualLapIntent: true,
};

const capacity: CapacityRevision = {
  id: "capacity-1",
  athleteId: "athlete-1",
  effectiveFrom: "2026-08-21T00:00:00.000Z",
  maxHrBpm: 203,
  restingHrBpm: 56,
  lt1HrBpm: 144,
  lt2HrBpm: 165,
  lt1PaceSecPerKm: 394,
  lt2PaceSecPerKm: 317,
  source: "lactate-test",
  createdAt: "2026-08-21T00:00:00.000Z",
};

const heartRateZones: ZoneSet = {
  id: "zones-hr-1",
  athleteId: "athlete-1",
  sport: "running",
  targetType: "heart_rate",
  name: "Lactate HR zones",
  effectiveFrom: "2026-08-21T00:00:00.000Z",
  source: "lactate-test",
  createdAt: "2026-08-21T00:00:00.000Z",
  zones: [
    { id: "z1", zoneNumber: 1, name: "Z1", upperBound: 132, unit: "bpm" },
    { id: "z2", zoneNumber: 2, name: "Z2", lowerBound: 132, upperBound: 147, unit: "bpm" },
    { id: "z3", zoneNumber: 3, name: "Z3", lowerBound: 148, upperBound: 155, unit: "bpm" },
    { id: "z4", zoneNumber: 4, name: "Z4", lowerBound: 157, upperBound: 173, unit: "bpm" },
    { id: "z5", zoneNumber: 5, name: "Z5", lowerBound: 174, unit: "bpm" },
  ],
};

function validWorkout(): WorkoutRevision {
  return buildWorkout(
    {
      workoutId: "workout-qa-1",
      version: 1,
      name: "Threshold validation",
      sport: "running",
      createdAt: "2026-09-11T09:00:00.000Z",
      createdByActor: "user",
      steps: [
        step("warmup", timeDuration(600), heartRateTarget(125, 140)),
        repeat(3, [
          step("active", distanceDuration(1000), paceTarget(310, 320)),
          step("recovery", timeDuration(120), heartRateTarget(130, 145)),
        ]),
        step("cooldown", timeDuration(600), noTarget()),
      ],
    },
    { idFactory: ids() },
  ).workout;
}

function calendarFor(workout: WorkoutRevision): ScheduledCalendarItem {
  return {
    id: "calendar-1",
    athleteId: "athlete-1",
    workout: { id: workout.workoutId, version: workout.version },
    planApplicationId: "application-1",
    sourcePlan: { id: "plan-1", version: 1, itemId: "plan-item-1" },
    scheduledStart: "2026-09-14T16:30:00.000Z",
    timezone: "Europe/London",
    scheduledLocalDate: "2026-09-14",
    scheduledLocalTime: "17:30",
    status: "planned",
    createdAt: "2026-09-11T09:00:00.000Z",
    updatedAt: "2026-09-11T09:00:00.000Z",
  };
}

test("valid structured workout passes reusable pre-sync QA", () => {
  const workout = validWorkout();
  const report = validateWorkoutForSync({
    workout,
    context: {
      capacity,
      zoneSets: [heartRateZones],
      calendarItem: calendarFor(workout),
      deliveryProfile,
    },
  });

  assert.equal(report.valid, true);
  assert.equal(report.errorCount, 0);
  assert.equal(report.warningCount, 0);
});

test("automatic steps cannot silently become manual-Lap/open steps", () => {
  const workout = validWorkout();
  const badOpen: WorkoutExecutionStep = {
    id: "bad-open",
    kind: "step",
    sequence: 0,
    phase: "active",
    durationType: "open",
    manualLapIntent: false,
    targetType: "none",
  };
  const malformed: WorkoutRevision = { ...workout, steps: [badOpen] };

  const report = validateWorkoutForSync({
    workout: malformed,
    context: { deliveryProfile },
  });

  assert.equal(report.valid, false);
  assert.ok(report.findings.some((item) => item.code === "MANUAL_LAP_INTENT_REQUIRED"));
});

test("pace × distance QA catches connector duration translation errors", () => {
  const workout = buildWorkout(
    {
      workoutId: "pace-math",
      version: 1,
      name: "3 km HM block",
      createdAt: "2026-09-11T09:00:00.000Z",
      createdByActor: "user",
      steps: [step("active", distanceDuration(3000), paceTarget(313))],
    },
    { idFactory: ids() },
  ).workout;
  const active = workout.steps[0];
  assert.equal(active.kind, "step");
  if (active.kind !== "step") throw new Error("Expected execution step.");

  const arithmetic = calculatePaceArithmetic(3000, 313);
  assert.equal(arithmetic.minDurationSeconds, 939);
  assert.equal(arithmetic.maxDurationSeconds, 939);

  const report = validateWorkoutForSync({
    workout,
    context: {
      deliveryProfile,
      syncProjection: {
        provider: "Intervals.icu",
        steps: {
          [active.id]: { distanceMeters: 3000, durationSeconds: 1045 },
        },
      },
    },
  });

  assert.equal(report.valid, false);
  assert.ok(report.findings.some((item) => item.code === "PACE_DISTANCE_DURATION_MISMATCH"));
});

test("calendar QA catches date/time and workout revision mismatches", () => {
  const workout = validWorkout();
  const calendar = {
    ...calendarFor(workout),
    workout: { id: workout.workoutId, version: 99 },
    scheduledLocalDate: "2026-09-15",
    scheduledLocalTime: "18:30",
  };

  const report = validateWorkoutForSync({
    workout,
    context: { calendarItem: calendar, deliveryProfile },
  });

  const codes = new Set(report.findings.map((item) => item.code));
  assert.equal(report.valid, false);
  assert.ok(codes.has("CALENDAR_WORKOUT_REVISION_MISMATCH"));
  assert.ok(codes.has("SCHEDULED_LOCAL_DATE_MISMATCH"));
  assert.ok(codes.has("SCHEDULED_LOCAL_TIME_MISMATCH"));
});

test("physiological QA rejects heart-rate targets beyond configured capacity", () => {
  const workout = buildWorkout(
    {
      workoutId: "bad-hr",
      version: 1,
      name: "Impossible HR target",
      createdAt: "2026-09-11T09:00:00.000Z",
      createdByActor: "ai_client",
      steps: [step("active", timeDuration(600), heartRateTarget(205, 215))],
    },
    { idFactory: ids() },
  ).workout;

  const report = validateWorkoutForSync({
    workout,
    context: { capacity, zoneSets: [heartRateZones], deliveryProfile },
  });

  assert.equal(report.valid, false);
  assert.ok(report.findings.some((item) => item.code === "HR_TARGET_ABOVE_MAX"));
});

test("delivery compatibility rejects unsupported targets, repeat depth and step count", () => {
  const workout = buildWorkout(
    {
      workoutId: "delivery-bad",
      version: 1,
      name: "Unsupported delivery",
      createdAt: "2026-09-11T09:00:00.000Z",
      createdByActor: "user",
      steps: [
        repeat(2, [
          repeat(2, [step("active", timeDuration(60), { type: "power", lowWatts: 200, highWatts: 220 })]),
        ]),
      ],
    },
    { idFactory: ids() },
  ).workout;

  const restrictiveProfile: DeliveryProfile = {
    ...deliveryProfile,
    maxRepeatDepth: 1,
    maxExpandedExecutionSteps: 3,
  };
  const report = validateWorkoutForSync({
    workout,
    context: { deliveryProfile: restrictiveProfile },
  });

  const codes = new Set(report.findings.map((item) => item.code));
  assert.equal(report.valid, false);
  assert.ok(codes.has("UNSUPPORTED_DELIVERY_TARGET"));
  assert.ok(codes.has("DELIVERY_REPEAT_DEPTH_EXCEEDED"));
  assert.ok(codes.has("DELIVERY_STEP_LIMIT_EXCEEDED"));
});

test("implausible totals generate actionable warnings without silently blocking valid structure", () => {
  const workout = buildWorkout(
    {
      workoutId: "long-run-warning",
      version: 1,
      name: "Very long run",
      createdAt: "2026-09-11T09:00:00.000Z",
      createdByActor: "user",
      steps: [step("active", distanceDuration(110_000), paceTarget(360))],
    },
    { idFactory: ids() },
  ).workout;

  const report = validateWorkoutForSync({ workout, context: {} });
  assert.equal(report.valid, true);
  assert.equal(report.errorCount, 0);
  assert.ok(report.findings.some((item) => item.code === "UNUSUALLY_LONG_WORKOUT_DISTANCE"));
  assert.ok(report.findings.some((item) => item.code === "UNUSUALLY_LONG_WORKOUT_DURATION"));
});

test("sync gate throws a typed QA error so invalid workouts cannot silently publish", () => {
  const workout = validWorkout();
  const first = workout.steps[0];
  assert.equal(first.kind, "step");
  if (first.kind !== "step") throw new Error("Expected execution step.");
  const malformed: WorkoutRevision = {
    ...workout,
    steps: [{ ...first, durationValue: 0 }],
  };

  assert.throws(
    () => assertWorkoutReadyForSync({ workout: malformed, context: { deliveryProfile } }),
    (error: unknown) =>
      error instanceof WorkoutQaError &&
      error.report.findings.some((item) => item.code === "INVALID_DURATION_VALUE"),
  );
});
