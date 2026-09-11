import assert from "node:assert/strict";
import test from "node:test";

import type {
  Activity,
  TrainingPlanRevision,
  WorkoutRevision,
} from "../domain/contracts";
import { applyTrainingPlan, workoutRevisionKey } from "./apply-plan";
import { buildCalendarView } from "./view";
import {
  AmbiguousLocalTimeError,
  NonexistentLocalTimeError,
  localDateTimeToUtc,
} from "./timezone";

const workout: WorkoutRevision = {
  workoutId: "workout-1",
  version: 3,
  name: "HM Pace Validation",
  sport: "running",
  steps: [],
  createdAt: "2026-09-11T08:00:00.000Z",
  createdByActor: "user",
};

const plan: TrainingPlanRevision = {
  planId: "plan-1",
  version: 4,
  name: "Cheltenham Half Final Week",
  createdAt: "2026-09-11T08:00:00.000Z",
  createdByActor: "user",
  items: [
    {
      id: "plan-item-1",
      sequence: 0,
      dayOffset: 0,
      localStartTime: "09:00",
      workoutId: workout.workoutId,
      workoutVersion: workout.version,
    },
    {
      id: "plan-item-2",
      sequence: 1,
      dayOffset: 2,
      localStartTime: "17:30",
      workoutId: workout.workoutId,
      workoutVersion: workout.version,
    },
    {
      id: "plan-item-3",
      sequence: 2,
      dayOffset: 8,
      localStartTime: "09:00",
      workoutId: workout.workoutId,
      workoutVersion: workout.version,
    },
  ],
};

function applyFixture() {
  let nextId = 1;
  return applyTrainingPlan(
    {
      athleteId: "athlete-1",
      plan,
      workouts: new Map([[workoutRevisionKey(workout.workoutId, workout.version), workout]]),
      startDate: "2026-09-12",
      timezone: "Europe/London",
    },
    {
      idFactory: () => `generated-${nextId++}`,
      now: () => "2026-09-11T08:30:00.000Z",
      actor: "user",
    },
  );
}

test("applying a plan converts relative days into explicit local dates and UTC instants", () => {
  const result = applyFixture();

  assert.equal(result.application.startDate, "2026-09-12");
  assert.equal(result.application.timezone, "Europe/London");
  assert.deepEqual(
    result.calendarItems.map((item) => item.scheduledLocalDate),
    ["2026-09-12", "2026-09-14", "2026-09-20"],
  );
  assert.deepEqual(
    result.calendarItems.map((item) => item.scheduledLocalTime),
    ["09:00", "17:30", "09:00"],
  );
  assert.deepEqual(
    result.calendarItems.map((item) => item.scheduledStart),
    [
      "2026-09-12T08:00:00.000Z",
      "2026-09-14T16:30:00.000Z",
      "2026-09-20T08:00:00.000Z",
    ],
  );
});

test("calendar records retain plan, plan-item, application and workout revision provenance", () => {
  const result = applyFixture();
  const item = result.calendarItems[0];

  assert.equal(item.planApplicationId, result.application.id);
  assert.deepEqual(item.sourcePlan, {
    id: "plan-1",
    version: 4,
    itemId: "plan-item-1",
  });
  assert.deepEqual(item.workout, { id: "workout-1", version: 3 });
  assert.equal(item.status, "planned");
});

test("calendar view distinguishes planned sessions from completed and unplanned activities", () => {
  const result = applyFixture();
  const completed: Activity = {
    id: "activity-1",
    athleteId: "athlete-1",
    calendarItemId: result.calendarItems[1].id,
    sport: "running",
    startedAt: "2026-09-14T16:31:00.000Z",
    endedAt: "2026-09-14T17:10:00.000Z",
    summary: {},
    normalizedData: {},
    sourceMetadata: {},
    createdAt: "2026-09-14T17:15:00.000Z",
    updatedAt: "2026-09-14T17:15:00.000Z",
  };
  const unplanned: Activity = {
    ...completed,
    id: "activity-2",
    calendarItemId: undefined,
    startedAt: "2026-09-15T10:00:00.000Z",
  };

  const view = buildCalendarView({
    calendarItems: result.calendarItems,
    activities: [completed, unplanned],
  });

  assert.equal(view[0].status, "planned");
  assert.equal(view[1].status, "completed");
  assert.equal(view[2].kind, "unplanned_completed");
});

test("timezone conversion rejects nonexistent DST wall-clock times", () => {
  assert.throws(
    () => localDateTimeToUtc("2026-03-29", "01:30", "Europe/London"),
    NonexistentLocalTimeError,
  );
});

test("timezone conversion rejects ambiguous DST wall-clock times unless explicitly disambiguated", () => {
  assert.throws(
    () => localDateTimeToUtc("2026-10-25", "01:30", "Europe/London"),
    AmbiguousLocalTimeError,
  );

  assert.equal(
    localDateTimeToUtc("2026-10-25", "01:30", "Europe/London", "earlier"),
    "2026-10-25T00:30:00.000Z",
  );
  assert.equal(
    localDateTimeToUtc("2026-10-25", "01:30", "Europe/London", "later"),
    "2026-10-25T01:30:00.000Z",
  );
});
