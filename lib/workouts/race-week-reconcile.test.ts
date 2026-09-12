import test from "node:test";
import assert from "node:assert/strict";
import { RACE_WEEK_2026 } from "./race-week";
import { classifyRaceWeekCalendar } from "./race-week-reconcile";

const workouts = RACE_WEEK_2026.map((definition) => ({
  id: `workout-${definition.key}`,
  currentRevision: { name: definition.name },
}));

function item(
  id: string,
  workoutId: string,
  date: string,
  time: string,
  createdAt: string,
  status = "planned",
) {
  return {
    id,
    scheduledLocalDate: date,
    scheduledLocalTime: time,
    status,
    createdAt,
    workout: { id: workoutId },
  };
}

test("race-week reconciliation retains one semantic session and identifies duplicate shakeouts", () => {
  const calendar = [
    item("monday", "workout-monday-rehearsal", "2026-09-14", "17:30", "2026-09-12T12:00:00.000Z"),
    item("shakeout-a", "workout-saturday-shakeout", "2026-09-19", "17:00", "2026-09-12T12:01:00.000Z"),
    item("shakeout-b", "workout-saturday-shakeout", "2026-09-19", "17:00", "2026-09-12T12:02:00.000Z"),
    item("shakeout-c", "workout-saturday-shakeout", "2026-09-19", "17:00", "2026-09-12T12:03:00.000Z"),
    item("sunday", "workout-sunday-race", "2026-09-20", "09:00", "2026-09-12T12:04:00.000Z"),
  ];

  const result = classifyRaceWeekCalendar(RACE_WEEK_2026, "2026-09-14", calendar, workouts);

  assert.equal(result.missing.length, 0);
  assert.equal(result.keepers["monday-rehearsal"]?.id, "monday");
  assert.equal(result.keepers["saturday-shakeout"]?.id, "shakeout-a");
  assert.equal(result.keepers["sunday-race"]?.id, "sunday");
  assert.deepEqual(result.duplicates.map((candidate) => candidate.id), ["shakeout-b", "shakeout-c"]);
});

test("superseded legacy entries are ignored and a genuinely missing session remains missing", () => {
  const calendar = [
    item("monday", "workout-monday-rehearsal", "2026-09-14", "17:30", "2026-09-12T12:00:00.000Z"),
    item("old-shakeout", "workout-saturday-shakeout", "2026-09-19", "17:00", "2026-09-12T12:01:00.000Z", "superseded"),
  ];

  const result = classifyRaceWeekCalendar(RACE_WEEK_2026, "2026-09-14", calendar, workouts);

  assert.deepEqual(result.missing.map((definition) => definition.key), ["saturday-shakeout", "sunday-race"]);
  assert.equal(result.duplicates.length, 0);
});
