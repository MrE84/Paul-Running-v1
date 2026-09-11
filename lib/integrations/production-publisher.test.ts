import assert from "node:assert/strict";
import test from "node:test";

import type { Athlete, Workout } from "../domain/contracts";
import type { ScheduledCalendarItem } from "../calendar/contracts";
import { buildWorkout } from "../workouts/builder";
import { advancedLunchWalkPreset } from "../workouts/presets";
import { InMemoryTrainingApiStore } from "../training-api/store";
import { InMemoryIntegrationStateStore } from "./state";
import { ProductionWorkoutPublisher } from "./production-publisher";

function fixture(scheduledStart = "2026-09-11T14:00:00.000Z") {
  const athlete: Athlete = {
    id: "athlete-1",
    displayName: "Paul",
    timezone: "Europe/London",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const preset = advancedLunchWalkPreset();
  let stepId = 0;
  const revision = buildWorkout(
    {
      workoutId: "advanced-lunch-walk",
      version: 1,
      name: preset.name,
      sport: "walking",
      steps: preset.steps,
      createdAt: "2026-09-11T12:00:00.000Z",
      createdByActor: "system",
    },
    { idFactory: () => `walk-step-${++stepId}` },
  ).workout;
  const workout: Workout = {
    id: revision.workoutId,
    athleteId: athlete.id,
    currentVersion: revision.version,
    currentRevision: revision,
    createdAt: revision.createdAt,
    updatedAt: revision.createdAt,
  };
  const calendarItem: ScheduledCalendarItem = {
    id: "calendar-lunch-walk",
    athleteId: athlete.id,
    workout: { id: workout.id, version: 1 },
    scheduledStart,
    timezone: "Europe/London",
    status: "planned",
    createdAt: "2026-09-11T12:00:00.000Z",
    updatedAt: "2026-09-11T12:00:00.000Z",
    planApplicationId: "validation-application",
    scheduledLocalDate: scheduledStart.slice(0, 10),
    scheduledLocalTime: "15:00:00",
  };
  return { athlete, workout, calendarItem };
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("production publisher sends the 5x2-minute lunch walk once and persists delivery state", async () => {
  const { athlete, workout, calendarItem } = fixture();
  const store = new InMemoryTrainingApiStore({
    athletes: [athlete],
    workouts: [workout],
    calendarItems: [calendarItem],
  });
  const state = new InMemoryIntegrationStateStore();
  const calls: Array<{ url: string; body: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    return response([{ id: 135360145, external_id: "paul-running:calendar-lunch-walk" }]);
  }) as typeof fetch;
  let id = 0;
  const publisher = new ProductionWorkoutPublisher({
    store,
    state,
    runtime: {
      idFactory: () => `runtime-${++id}`,
      now: () => "2026-09-11T13:00:00.000Z",
    },
    apiKey: "test-secret",
    fetchImpl,
  });

  const first = await publisher.publishCalendarItem(calendarItem.id, {
    actorType: "ai_client",
    actorId: "chatgpt",
    requestId: "request-1",
  });
  assert.equal(first.attempted, true);
  assert.equal(first.deliveryState, "sent");
  assert.equal(first.reason, "sent_current");
  assert.equal(first.externalId, "135360145");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/events\/bulk\?upsert=true$/);
  const body = JSON.parse(calls[0].body) as Array<Record<string, unknown>>;
  assert.equal(body[0]?.type, "Walk");
  assert.equal(body[0]?.name, "Advanced Lunch Break Walk");
  assert.equal((String(body[0]?.description).match(/2m/g) ?? []).length, 5);

  const second = await publisher.publishCalendarItem(calendarItem.id);
  assert.equal(second.attempted, false);
  assert.equal(second.deliveryState, "sent");
  assert.equal(second.reason, "sent_current");
  assert.equal(second.externalId, "135360145");
  assert.equal(calls.length, 1);

  const reference = await state.findExternalReference(
    "intervals_icu",
    "calendar_item",
    calendarItem.id,
  );
  const latestJob = await state.findLatestSyncJob(
    "intervals_icu",
    "calendar_item",
    calendarItem.id,
  );
  assert.equal(reference?.externalId, "135360145");
  assert.equal(latestJob?.state, "succeeded");
  assert.equal((await store.listAuditEvents()).length, 1);
});

test("production publisher does not send workouts outside the rolling Garmin window", async () => {
  const { athlete, workout, calendarItem } = fixture("2026-09-25T14:00:00.000Z");
  const store = new InMemoryTrainingApiStore({
    athletes: [athlete],
    workouts: [workout],
    calendarItems: [calendarItem],
  });
  const state = new InMemoryIntegrationStateStore();
  let calls = 0;
  const publisher = new ProductionWorkoutPublisher({
    store,
    state,
    runtime: {
      idFactory: () => "runtime-id",
      now: () => "2026-09-11T13:00:00.000Z",
    },
    apiKey: "test-secret",
    fetchImpl: (async () => {
      calls += 1;
      return response([]);
    }) as typeof fetch,
  });

  const result = await publisher.publishCalendarItem(calendarItem.id);
  assert.equal(result.attempted, false);
  assert.equal(result.eligible, false);
  assert.equal(result.deliveryState, "planned");
  assert.equal(result.reason, "outside_window");
  assert.equal(calls, 0);
});
