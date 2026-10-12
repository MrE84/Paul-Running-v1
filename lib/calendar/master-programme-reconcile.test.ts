import test from "node:test";
import assert from "node:assert/strict";
import type { Athlete } from "../domain/contracts";
import { InMemoryIntegrationStateStore } from "../integrations/state";
import { TrainingApiService } from "../training-api/service";
import { InMemoryTrainingApiStore } from "../training-api/store";
import { reconcileMasterProgramme, type ScheduledProgrammeSession } from "./master-programme-reconcile";

const athlete: Athlete = {
  id: "athlete-master-programme",
  displayName: "Master Programme Test",
  timezone: "Europe/London",
  createdAt: "2026-10-12T08:00:00.000Z",
  updatedAt: "2026-10-12T08:00:00.000Z",
};

const canonicalProgramme: ScheduledProgrammeSession[] = [
  {
    id: "canonical-mon",
    scheduledStart: "2026-10-12T17:00:00.000Z",
    timezone: "Europe/London",
    title: "Long Aerobic 85 min",
    notes: "Canonical Monday long run",
    workout: {
      workoutName: "Long Aerobic 85 min",
      sport: "RUNNING",
      steps: [{
        type: "WorkoutStep",
        stepOrder: 0,
        intensity: "INTERVAL",
        durationType: "TIME",
        durationValue: 5100,
        targetType: "HEART_RATE",
        targetValueLow: 135,
        targetValueHigh: 145,
        description: "Easy aerobic durability",
      }],
    },
  },
  {
    id: "canonical-wed",
    scheduledStart: "2026-10-14T17:00:00.000Z",
    timezone: "Europe/London",
    title: "Threshold 3 × 10 min",
    notes: "Canonical Wednesday threshold",
    workout: {
      workoutName: "Threshold 3 × 10 min",
      sport: "RUNNING",
      steps: [{
        type: "WorkoutRepeatStep",
        // Tredict can number a nested repeat according to the flattened provider
        // representation. Paul's Running must normalize this to array sequence 0.
        stepOrder: 3,
        repeatValue: 3,
        description: "Three controlled threshold reps",
        steps: [
          {
            type: "WorkoutStep",
            stepOrder: 1,
            intensity: "INTERVAL",
            durationType: "TIME",
            durationValue: 600,
            targetType: "SPEED",
            targetValueLow: 1000 / 297,
            targetValueHigh: 1000 / 287,
            description: "Threshold rep",
          },
          {
            type: "WorkoutStep",
            stepOrder: 2,
            intensity: "RECOVERY",
            durationType: "TIME",
            durationValue: 180,
            targetType: "HEART_RATE",
            targetValueLow: 130,
            targetValueHigh: 150,
            description: "Easy jog",
          },
        ],
      }],
    },
  },
];

function harness() {
  let id = 0;
  const store = new InMemoryTrainingApiStore({ athletes: [athlete] });
  const service = new TrainingApiService(
    store,
    { idFactory: () => `id-${++id}`, now: () => "2026-10-12T09:00:00.000Z" },
    new InMemoryIntegrationStateStore(),
  );
  const actor = (key: string) => ({
    type: "ai_client" as const,
    id: "test-client",
    requestId: `req-${key}`,
    idempotencyKey: key,
  });
  return { store, service, actor };
}

test("master programme replaces stale future calendar items and removes sessions on rest days", async () => {
  const { store, service, actor } = harness();

  const staleTuesday = (await service.createWorkout({
    athleteId: athlete.id,
    name: "Easy Run 35 min",
    sport: "running",
    steps: [{
      id: "stale-tue-step",
      kind: "step",
      sequence: 0,
      phase: "active",
      durationType: "time",
      durationValue: 2100,
      durationUnit: "seconds",
      targetType: "none",
    }],
  }, actor("stale-tue-workout"))).workout;

  const staleWednesday = (await service.createWorkout({
    athleteId: athlete.id,
    name: "Build Week 2 - Tempo Intervals",
    sport: "running",
    steps: [{
      id: "stale-wed-step",
      kind: "step",
      sequence: 0,
      phase: "active",
      durationType: "time",
      durationValue: 1800,
      durationUnit: "seconds",
      targetType: "none",
    }],
  }, actor("stale-wed-workout"))).workout;

  const stalePlan = await service.createPlan({
    athleteId: athlete.id,
    name: "Old week two",
    items: [
      { id: "old-tue", sequence: 0, dayOffset: 1, localStartTime: "18:00", workoutId: staleTuesday.id, workoutVersion: staleTuesday.currentVersion },
      { id: "old-wed", sequence: 1, dayOffset: 2, localStartTime: "18:00", workoutId: staleWednesday.id, workoutVersion: staleWednesday.currentVersion },
    ],
  }, actor("stale-plan"));
  const staleApplication = await service.applyPlan(stalePlan.id, {
    planVersion: stalePlan.currentVersion,
    startDate: "2026-10-12",
    timezone: "Europe/London",
  }, actor("stale-apply"));

  const first = await reconcileMasterProgramme({
    service,
    athleteId: athlete.id,
    fromDate: "2026-10-12",
    programme: canonicalProgramme,
    actor: { type: "ai_client", id: "reconciler", requestId: "reconcile-1" },
  });

  assert.equal(first.staleItemsSuperseded, 2);
  assert.equal(first.calendarItemsCreated, 2);
  assert.equal(first.changed, true);
  for (const stale of staleApplication.calendarItems) {
    assert.equal((await store.getCalendarItem(stale.id))?.status, "superseded");
  }

  const calendar = await service.listCalendar(athlete.id);
  const planned = calendar.filter((item) => item.status === "planned");
  const plannedNames = await Promise.all(planned.map(async (item) => (await service.getWorkout(item.workout.id)).currentRevision.name));
  assert.deepEqual(plannedNames.sort(), ["Long Aerobic 85 min", "Threshold 3 × 10 min"].sort());
  assert.equal(planned.some((item) => item.scheduledStart.startsWith("2026-10-13")), false);

  const second = await reconcileMasterProgramme({
    service,
    athleteId: athlete.id,
    fromDate: "2026-10-12",
    programme: canonicalProgramme,
    actor: { type: "ai_client", id: "reconciler", requestId: "reconcile-2" },
  });
  assert.equal(second.changed, false);
  assert.equal(second.staleItemsSuperseded, 0);
  assert.equal(second.calendarItemsCreated, 0);
});
