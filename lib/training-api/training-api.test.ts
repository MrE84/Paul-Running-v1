import test from "node:test";
import assert from "node:assert/strict";
import type { Activity, Athlete, CapacityRevision, ZoneSet } from "../domain/contracts";
import { InMemoryIntegrationStateStore } from "../integrations/state";
import { InMemoryTrainingApiStore } from "./store";
import { TrainingApiError, TrainingApiService } from "./service";
import { sampleFit } from "../activity-analysis/sample";

const athlete: Athlete = {
  id: "athlete-1",
  displayName: "Test Athlete",
  timezone: "Europe/London",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const capacity: CapacityRevision = {
  id: "capacity-1",
  athleteId: athlete.id,
  effectiveFrom: "2026-09-01T00:00:00.000Z",
  maxHrBpm: 198,
  restingHrBpm: 61,
  lt2HrBpm: 165,
  source: "test",
  createdAt: "2026-09-01T00:00:00.000Z",
};

const zones: ZoneSet = {
  id: "zones-1",
  athleteId: athlete.id,
  sport: "running",
  targetType: "heart_rate",
  name: "Running HR",
  effectiveFrom: "2026-09-01T00:00:00.000Z",
  source: "test",
  zones: [{ id: "z1", zoneNumber: 1, name: "Easy", lowerBound: 100, upperBound: 150, unit: "bpm" }],
  createdAt: "2026-09-01T00:00:00.000Z",
};

function validSteps() {
  return [{
    id: "step-1",
    kind: "step" as const,
    sequence: 0,
    phase: "active" as const,
    durationType: "time" as const,
    durationValue: 600,
    durationUnit: "seconds",
    targetType: "none" as const,
  }];
}

function harness(extra: { activities?: Activity[] } = {}) {
  let id = 0;
  const store = new InMemoryTrainingApiStore({
    athletes: [athlete],
    capacities: [capacity],
    zoneSets: [zones],
    activities: extra.activities,
  });
  const integrationState = new InMemoryIntegrationStateStore();
  const service = new TrainingApiService(
    store,
    { idFactory: () => `id-${++id}`, now: () => "2026-09-11T12:00:00.000Z" },
    integrationState,
  );
  const actor = (key: string) => ({ type: "ai_client" as const, id: "chatgpt", requestId: `req-${key}`, idempotencyKey: key });
  return { store, integrationState, service, actor };
}

test("profile read deterministically returns active capacity and zones", async () => {
  const { service } = harness();
  const profile = await service.getProfile(athlete.id);
  assert.equal(profile.athlete.id, athlete.id);
  assert.equal(profile.currentCapacity?.lt2HrBpm, 165);
  assert.deepEqual(profile.zoneSets.map((set) => set.id), ["zones-1"]);
});

test("create workout is QA-gated, idempotent and auditable", async () => {
  const { service, store, actor } = harness();
  const input = { athleteId: athlete.id, name: "Easy 10", sport: "running" as const, steps: validSteps() };
  const first = await service.createWorkout(input, actor("create-1"));
  const replay = await service.createWorkout(input, actor("create-1"));
  assert.equal(first.workout.id, replay.workout.id);
  assert.equal(first.qa.valid, true);
  assert.equal((await service.listWorkouts(athlete.id)).length, 1);
  const audits = await store.listAuditEvents();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actorType, "ai_client");
  assert.equal(audits[0].actorId, "chatgpt");
});

test("invalid workout cannot be persisted and returns structured QA findings", async () => {
  const { service, actor } = harness();
  await assert.rejects(
    service.createWorkout({ athleteId: athlete.id, name: "Broken", sport: "running", steps: [{ ...validSteps()[0], durationValue: 0 }] }, actor("bad-1")),
    (error: unknown) => error instanceof TrainingApiError && error.status === 422 && error.code === "WORKOUT_QA_FAILED",
  );
  assert.equal((await service.listWorkouts(athlete.id)).length, 0);
});

test("idempotency key reuse with a changed command is rejected", async () => {
  const { service, actor } = harness();
  await service.createWorkout({ athleteId: athlete.id, name: "First", sport: "running", steps: validSteps() }, actor("same-key"));
  await assert.rejects(
    service.createWorkout({ athleteId: athlete.id, name: "Changed", sport: "running", steps: validSteps() }, actor("same-key")),
    (error: unknown) => error instanceof TrainingApiError && error.status === 409 && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("workout edits use optimistic concurrency and preserve old revisions", async () => {
  const { service, store, actor } = harness();
  const created = await service.createWorkout({ athleteId: athlete.id, name: "Threshold", sport: "running", steps: validSteps() }, actor("create-edit"));
  const revised = await service.patchWorkout(created.workout.id, { expectedVersion: 1, change: { name: "Threshold revised" } }, actor("patch-1"));
  assert.equal(revised.workout.currentVersion, 2);
  assert.equal(revised.workout.currentRevision.name, "Threshold revised");
  assert.equal((await store.getWorkoutRevision(created.workout.id, 1))?.name, "Threshold");
  await assert.rejects(
    service.patchWorkout(created.workout.id, { expectedVersion: 1, change: { name: "Stale overwrite" } }, actor("patch-stale")),
    (error: unknown) => error instanceof TrainingApiError && error.code === "VERSION_CONFLICT",
  );
});

test("plan creation and apply resolve relative days into concrete local dates", async () => {
  const { service, actor } = harness();
  const workout = (await service.createWorkout({ athleteId: athlete.id, name: "Plan workout", sport: "running", steps: validSteps() }, actor("plan-workout"))).workout;
  const plan = await service.createPlan({
    athleteId: athlete.id,
    name: "Two-day plan",
    items: [
      { id: "item-1", sequence: 0, dayOffset: 0, localStartTime: "09:00:00", workoutId: workout.id, workoutVersion: 1 },
      { id: "item-2", sequence: 1, dayOffset: 2, localStartTime: "18:30:00", workoutId: workout.id, workoutVersion: 1 },
    ],
  }, actor("plan-create"));
  const applied = await service.applyPlan(plan.id, { planVersion: 1, startDate: "2026-09-12", timezone: "Europe/London" }, actor("plan-apply"));
  assert.deepEqual(applied.calendarItems.map((item) => item.scheduledLocalDate), ["2026-09-12", "2026-09-14"]);
  assert.equal(applied.calendarItems[0].workout.version, 1);
  assert.equal(applied.calendarItems[0].status, "planned");
});

test("activity reads are latest-first and bounded", async () => {
  const base = {
    athleteId: athlete.id,
    sport: "running" as const,
    summary: {},
    normalizedData: {},
    sourceMetadata: {},
    createdAt: "2026-09-11T12:00:00.000Z",
    updatedAt: "2026-09-11T12:00:00.000Z",
  };
  const activities: Activity[] = [
    { ...base, id: "a1", startedAt: "2026-09-01T08:00:00.000Z" },
    { ...base, id: "a2", startedAt: "2026-09-10T08:00:00.000Z" },
    { ...base, id: "a3", startedAt: "2026-09-11T08:00:00.000Z" },
  ];
  const { service } = harness({ activities });
  assert.deepEqual((await service.listActivities(athlete.id, 2)).map((item) => item.id), ["a3", "a2"]);
});

test("activity analysis caches versioned intelligence and route weather separately from device temperature", async () => {
  const activity: Activity = {
    id: "weather-run",
    athleteId: athlete.id,
    sport: "running",
    startedAt: "2026-09-10T08:00:00.000Z",
    summary: { durationSeconds: 600 },
    normalizedData: sampleFit(600),
    sourceMetadata: { name: "Weather run" },
    createdAt: "2026-09-11T12:00:00.000Z",
    updatedAt: "2026-09-11T12:00:00.000Z",
  };
  const { service, store } = harness({ activities: [activity] });
  const projection = await service.getActivityAnalysis(athlete.id, activity.id);
  assert.equal(projection.intelligence?.version, "1.1.0");
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    if (fetchCalls <= 10) return new Response(JSON.stringify({ reason: "Temporary weather provider failure" }), { status: 503 });
    return new Response(JSON.stringify({ hourly: {
      time: ["2026-09-10T08:00"], temperature_2m: [12], apparent_temperature: [11],
      relative_humidity_2m: [70], dew_point_2m: [7], precipitation: [0], surface_pressure: [1012],
      cloud_cover: [20], wind_speed_10m: [3], wind_gusts_10m: [5], wind_direction_10m: [180],
    } }), { status: 200 });
  };
  const failed = await service.getActivityWeather(athlete.id, activity.id, false, fetchImpl as typeof fetch);
  assert.equal(failed.weather?.status, "failed");
  const enriched = await service.getActivityWeather(athlete.id, activity.id, false, fetchImpl as typeof fetch);
  assert.equal(enriched.weather?.status, "available");
  assert.ok(fetchCalls > 10);
  assert.equal(enriched.streams.channels.ambient_temperature?.[0], 12);
  assert.equal(enriched.streams.channels.temperature?.[0], projection.streams.channels.temperature?.[0]);
  assert.equal((await store.getAnalysisCache(activity.id))?.projection.weather?.version, enriched.weather?.version);
});

test("comparison and longitudinal reads stay athlete-scoped and expose versioned Batch C analytics", async () => {
  const base = {
    athleteId: athlete.id,
    sport: "running" as const,
    createdAt: "2026-09-11T12:00:00.000Z",
    updatedAt: "2026-09-11T12:00:00.000Z",
  };
  const activities: Activity[] = [
    { ...base, id: "history-1", startedAt: "2026-08-01T08:00:00.000Z", summary: { durationSeconds: 900, distanceMeters: 2600 }, normalizedData: sampleFit(900), sourceMetadata: { name: "First run", shoe: "Evo SL" } },
    { ...base, id: "history-2", startedAt: "2026-08-08T08:00:00.000Z", summary: { durationSeconds: 900, distanceMeters: 2700 }, normalizedData: sampleFit(900), sourceMetadata: { name: "Second run", shoe: "Rocket X 3" } },
  ];
  const { service } = harness({ activities });
  const comparison = await service.getActivityComparison(athlete.id, ["history-1", "history-2"]);
  assert.deepEqual(comparison.map(item => item.activity.id), ["history-1", "history-2"]);
  assert.ok(comparison.every(item => item.intelligence?.version));
  await assert.rejects(service.getActivityComparison(athlete.id, ["history-1", "history-1"]), (error: unknown) => error instanceof TrainingApiError && error.status === 400);
  const trends = await service.getActivityTrends(athlete.id, { bucket: "week", sport: "running" });
  assert.equal(trends.version, "1.0.0");
  assert.equal(trends.totals.activities, 2);
  assert.deepEqual(trends.equipment.map(item => item.name).sort(), ["Evo SL", "Rocket X 3"]);
  assert.equal(trends.quality.skippedActivities.length, 0);
});

test("sync status is a separate projection from canonical calendar status", async () => {
  const { service, integrationState, actor } = harness();
  const workout = (await service.createWorkout({ athleteId: athlete.id, name: "Sync workout", sport: "running", steps: validSteps() }, actor("sync-workout"))).workout;
  const plan = await service.createPlan({ athleteId: athlete.id, name: "Sync plan", items: [{ id: "sync-item", sequence: 0, dayOffset: 0, localStartTime: "09:00:00", workoutId: workout.id, workoutVersion: 1 }] }, actor("sync-plan"));
  const calendarItem = (await service.applyPlan(plan.id, { planVersion: 1, startDate: "2026-09-12", timezone: "Europe/London" }, actor("sync-apply"))).calendarItems[0];
  await integrationState.saveSyncJob({ id: "job-1", athleteId: athlete.id, provider: "intervals_icu", entityType: "calendar_item", entityId: calendarItem.id, entityVersion: 1, operation: "publish", state: "succeeded", idempotencyKey: "sync-key", attemptCount: 1, createdAt: "2026-09-11T12:00:00.000Z", updatedAt: "2026-09-11T12:01:00.000Z", completedAt: "2026-09-11T12:01:00.000Z" });
  await integrationState.saveExternalReference({ id: "ref-1", athleteId: athlete.id, entityType: "calendar_item", entityId: calendarItem.id, provider: "intervals_icu", externalId: "provider-1", providerMetadata: {}, createdAt: "2026-09-11T12:01:00.000Z", updatedAt: "2026-09-11T12:01:00.000Z" });
  const sync = await service.getSyncStatus(calendarItem.id);
  assert.equal(sync.calendarItem.status, "planned");
  assert.equal(sync.state, "sent");
  assert.equal(sync.externalReference?.externalId, "provider-1");
});
