import assert from "node:assert/strict";
import test from "node:test";

import type {
  CanonicalScheduledWorkout,
  ConnectorResult,
  ExternalReference,
  TrainingSyncConnector,
} from "../domain/contracts";
import type { IntegrationRuntime } from "./contracts";
import { TrainingSyncCoordinator } from "./coordinator";
import { InMemoryIntegrationStateStore } from "./state";
import { RollingSyncWindowService } from "./sync-window";

function idFactory(prefix = "id") {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

function scheduledWorkout(input: {
  id: string;
  scheduledStart: string;
  updatedAt?: string;
  version?: number;
  status?: "planned" | "completed" | "skipped" | "canceled" | "superseded";
}): CanonicalScheduledWorkout {
  const version = input.version ?? 1;
  return {
    athlete: {
      id: "athlete-1",
      displayName: "Paul",
      timezone: "Europe/London",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    calendarItem: {
      id: input.id,
      athleteId: "athlete-1",
      workout: { id: `workout-${input.id}`, version },
      scheduledStart: input.scheduledStart,
      timezone: "Europe/London",
      status: input.status ?? "planned",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: input.updatedAt ?? "2026-09-11T09:00:00.000Z",
    },
    workout: {
      workoutId: `workout-${input.id}`,
      version,
      name: `Workout ${input.id}`,
      sport: "running",
      steps: [],
      createdAt: "2026-09-01T00:00:00.000Z",
      createdByActor: "user",
    },
  };
}

interface FakeConnectorControl {
  publishCalls: string[];
  updateCalls: string[];
  nextPublishResults: ConnectorResult[];
}

function fakeConnector(control: FakeConnectorControl): TrainingSyncConnector {
  return {
    provider: "intervals_icu",
    async publish(input): Promise<ConnectorResult> {
      control.publishCalls.push(input.calendarItem.id);
      const queued = control.nextPublishResults.shift();
      return queued ?? { ok: true, externalId: `event-${input.calendarItem.id}` };
    },
    async update(input, reference): Promise<ConnectorResult> {
      control.updateCalls.push(input.calendarItem.id);
      return { ok: true, externalId: reference.externalId };
    },
    async cancel(_item, reference): Promise<ConnectorResult> {
      return { ok: true, externalId: reference.externalId };
    },
  };
}

function harness(initialNow = "2026-09-11T10:00:00.000Z") {
  let now = initialNow;
  const runtime: IntegrationRuntime = {
    idFactory: idFactory("runtime"),
    now: () => now,
  };
  const state = new InMemoryIntegrationStateStore();
  const control: FakeConnectorControl = {
    publishCalls: [],
    updateCalls: [],
    nextPublishResults: [],
  };
  const coordinator = new TrainingSyncCoordinator({
    connector: fakeConnector(control),
    state,
    runtime,
  });
  const window = new RollingSyncWindowService({
    provider: "intervals_icu",
    coordinator,
    state,
    runtime,
    policy: { lookAheadDays: 7, lookBehindHours: 24 },
  });

  return {
    state,
    control,
    window,
    setNow(value: string) {
      now = value;
    },
  };
}

test("full plan remains visible while only near-term workouts are queued", async () => {
  const { window } = harness();
  const near = scheduledWorkout({
    id: "near",
    scheduledStart: "2026-09-13T08:00:00.000Z",
  });
  const future = scheduledWorkout({
    id: "future",
    scheduledStart: "2026-09-25T08:00:00.000Z",
  });

  const items = await window.scan([future, near]);
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => [item.calendarItemId, item.deliveryState, item.eligible]),
    [
      ["near", "queued", true],
      ["future", "planned", false],
    ],
  );
});

test("sync service attempts only eligible near-term workouts and marks them sent", async () => {
  const { window, control } = harness();
  const near = scheduledWorkout({
    id: "near",
    scheduledStart: "2026-09-13T08:00:00.000Z",
  });
  const future = scheduledWorkout({
    id: "future",
    scheduledStart: "2026-09-25T08:00:00.000Z",
  });

  const result = await window.syncEligible([near, future]);
  assert.deepEqual(control.publishCalls, ["near"]);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.items.find((item) => item.calendarItemId === "near")?.deliveryState, "sent");
  assert.equal(result.items.find((item) => item.calendarItemId === "future")?.deliveryState, "planned");
});

test("future workouts are re-evaluated and released when they enter the rolling window", async () => {
  const { window, control, setNow } = harness();
  const future = scheduledWorkout({
    id: "future",
    scheduledStart: "2026-09-20T08:00:00.000Z",
  });

  const first = await window.syncEligible([future]);
  assert.equal(first.attempts.length, 0);
  assert.equal(first.items[0]?.deliveryState, "planned");

  setNow("2026-09-13T10:00:00.000Z");
  const second = await window.syncEligible([future]);
  assert.equal(second.attempts.length, 1);
  assert.deepEqual(control.publishCalls, ["future"]);
  assert.equal(second.items[0]?.deliveryState, "sent");
});

test("already-sent current source is not duplicated, but a source edit is queued as an update", async () => {
  const { window, control, setNow } = harness();
  const original = scheduledWorkout({
    id: "threshold",
    scheduledStart: "2026-09-13T18:00:00.000Z",
    updatedAt: "2026-09-11T09:00:00.000Z",
  });

  const first = await window.syncEligible([original]);
  assert.equal(first.items[0]?.deliveryState, "sent");
  assert.deepEqual(control.publishCalls, ["threshold"]);

  const unchanged = await window.syncEligible([original]);
  assert.equal(unchanged.attempts.length, 0);
  assert.deepEqual(control.publishCalls, ["threshold"]);

  setNow("2026-09-11T10:05:00.000Z");
  const edited = scheduledWorkout({
    id: "threshold",
    scheduledStart: "2026-09-13T19:00:00.000Z",
    updatedAt: "2026-09-11T10:04:00.000Z",
  });
  const beforeUpdate = await window.scan([edited]);
  assert.equal(beforeUpdate[0]?.deliveryState, "queued");

  const updated = await window.syncEligible([edited]);
  assert.deepEqual(control.updateCalls, ["threshold"]);
  assert.equal(updated.items[0]?.deliveryState, "sent");
});

test("retryable failures display failed, respect nextAttemptAt, then retry when due", async () => {
  const { window, control, setNow } = harness();
  control.nextPublishResults.push({
    ok: false,
    kind: "retryable",
    code: "RATE_LIMITED",
    message: "Retry later",
    providerMetadata: { retryAfterSeconds: 120 },
  });
  const input = scheduledWorkout({
    id: "intervals",
    scheduledStart: "2026-09-12T18:00:00.000Z",
  });

  const first = await window.syncEligible([input]);
  assert.equal(first.attempts.length, 1);
  assert.equal(first.items[0]?.deliveryState, "failed");
  assert.equal(first.items[0]?.reason, "retry_wait");

  setNow("2026-09-11T10:01:00.000Z");
  const waiting = await window.syncEligible([input]);
  assert.equal(waiting.attempts.length, 0);
  assert.equal(control.publishCalls.length, 1);
  assert.equal(waiting.items[0]?.deliveryState, "failed");

  setNow("2026-09-11T10:02:00.000Z");
  const retried = await window.syncEligible([input]);
  assert.equal(retried.attempts.length, 1);
  assert.equal(control.publishCalls.length, 2);
  assert.equal(retried.items[0]?.deliveryState, "sent");
});

test("permanent failures remain visible as failed and are not silently retried", async () => {
  const { window, control } = harness();
  control.nextPublishResults.push({
    ok: false,
    kind: "permanent",
    code: "WORKOUT_QA_FAILED",
    message: "Invalid workout",
  });
  const input = scheduledWorkout({
    id: "bad-workout",
    scheduledStart: "2026-09-12T18:00:00.000Z",
  });

  const first = await window.syncEligible([input]);
  assert.equal(first.items[0]?.deliveryState, "failed");
  assert.equal(first.items[0]?.reason, "sync_failed");

  const second = await window.syncEligible([input]);
  assert.equal(second.attempts.length, 0);
  assert.equal(control.publishCalls.length, 1);
  assert.equal(second.items[0]?.deliveryState, "failed");
});

test("current delivery can be reconstructed from persisted state without mutating the canonical calendar item", async () => {
  const { window, state } = harness();
  const input = scheduledWorkout({
    id: "state-check",
    scheduledStart: "2026-09-13T18:00:00.000Z",
  });

  await window.syncEligible([input]);
  const reference = await state.findExternalReference(
    "intervals_icu",
    "calendar_item",
    input.calendarItem.id,
  );
  assert.ok(reference as ExternalReference | undefined);
  assert.equal(input.calendarItem.status, "planned");
  assert.equal((await window.scan([input]))[0]?.deliveryState, "sent");
});
