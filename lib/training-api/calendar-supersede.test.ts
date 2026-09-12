import test from "node:test";
import assert from "node:assert/strict";
import type { Athlete } from "../domain/contracts";
import { InMemoryIntegrationStateStore } from "../integrations/state";
import { TrainingApiService } from "./service";
import { InMemoryTrainingApiStore } from "./store";

const athlete: Athlete = {
  id: "athlete-calendar-cleanup",
  displayName: "Calendar Cleanup",
  timezone: "Europe/London",
  createdAt: "2026-09-12T12:00:00.000Z",
  updatedAt: "2026-09-12T12:00:00.000Z",
};

const steps = [{
  id: "step-1",
  kind: "step" as const,
  sequence: 0,
  phase: "active" as const,
  durationType: "time" as const,
  durationValue: 600,
  durationUnit: "seconds",
  targetType: "none" as const,
}];

test("planned duplicate calendar items can be superseded idempotently and persist the canonical status", async () => {
  let id = 0;
  const store = new InMemoryTrainingApiStore({ athletes: [athlete] });
  const integrationState = new InMemoryIntegrationStateStore();
  const service = new TrainingApiService(
    store,
    { idFactory: () => `id-${++id}`, now: () => "2026-09-12T15:00:00.000Z" },
    integrationState,
  );
  const actor = (key: string) => ({
    type: "ai_client" as const,
    id: "calendar-web",
    requestId: `req-${key}`,
    idempotencyKey: key,
  });

  const workout = (await service.createWorkout({
    athleteId: athlete.id,
    name: "Optional Pre-Race Shakeout",
    sport: "running",
    steps,
  }, actor("workout"))).workout;
  const plan = await service.createPlan({
    athleteId: athlete.id,
    name: "Shakeout duplicate test",
    items: [{
      id: "shakeout-item",
      sequence: 0,
      dayOffset: 0,
      localStartTime: "17:00",
      workoutId: workout.id,
      workoutVersion: workout.currentVersion,
    }],
  }, actor("plan"));
  const calendarItem = (await service.applyPlan(plan.id, {
    planVersion: plan.currentVersion,
    startDate: "2026-09-19",
    timezone: "Europe/London",
  }, actor("apply"))).calendarItems[0];

  const first = await service.supersedeCalendarItem(calendarItem.id, actor("supersede"));
  const replay = await service.supersedeCalendarItem(calendarItem.id, actor("supersede"));

  assert.equal(first.status, "superseded");
  assert.equal(replay.status, "superseded");
  assert.equal((await store.getCalendarItem(calendarItem.id))?.status, "superseded");
  const audits = await store.listAuditEvents();
  assert.equal(audits.filter((event) => event.action === "calendar_item.superseded").length, 1);
});
