import assert from "node:assert/strict";
import test from "node:test";

import type {
  CanonicalScheduledWorkout,
  ConnectorResult,
  TrainingSyncConnector,
} from "../domain/contracts";
import type { IntegrationRuntime } from "./contracts";
import { TrainingSyncCoordinator } from "./coordinator";
import { InMemoryIntegrationStateStore } from "./state";
import { RollingSyncWindowService } from "./sync-window";

function workout(updatedAt: string): CanonicalScheduledWorkout {
  return {
    athlete: {
      id: "athlete-1",
      displayName: "Paul",
      timezone: "Europe/London",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    calendarItem: {
      id: "calendar-edit",
      athleteId: "athlete-1",
      workout: { id: "workout-edit", version: 1 },
      scheduledStart: "2026-09-13T18:00:00.000Z",
      timezone: "Europe/London",
      status: "planned",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt,
    },
    workout: {
      workoutId: "workout-edit",
      version: 1,
      name: "Edited workout",
      sport: "running",
      steps: [],
      createdAt: "2026-09-01T00:00:00.000Z",
      createdByActor: "user",
    },
  };
}

test("editing a source snapshot releases a previous permanent failure for re-evaluation", async () => {
  let now = "2026-09-11T10:00:00.000Z";
  let ids = 0;
  let publishCalls = 0;
  const runtime: IntegrationRuntime = {
    idFactory: () => `id-${++ids}`,
    now: () => now,
  };
  const connector: TrainingSyncConnector = {
    provider: "intervals_icu",
    async publish(input): Promise<ConnectorResult> {
      publishCalls += 1;
      if (publishCalls === 1) {
        return {
          ok: false,
          kind: "permanent",
          code: "WORKOUT_QA_FAILED",
          message: "Invalid first snapshot",
        };
      }
      return { ok: true, externalId: `event-${input.calendarItem.id}` };
    },
    async update(_input, reference): Promise<ConnectorResult> {
      return { ok: true, externalId: reference.externalId };
    },
    async cancel(_item, reference): Promise<ConnectorResult> {
      return { ok: true, externalId: reference.externalId };
    },
  };
  const state = new InMemoryIntegrationStateStore();
  const coordinator = new TrainingSyncCoordinator({ connector, state, runtime });
  const window = new RollingSyncWindowService({
    provider: connector.provider,
    coordinator,
    state,
    runtime,
    policy: { lookAheadDays: 7, lookBehindHours: 24 },
  });

  const original = workout("2026-09-11T09:00:00.000Z");
  const failed = await window.syncEligible([original]);
  assert.equal(failed.items[0]?.deliveryState, "failed");
  assert.equal(publishCalls, 1);

  const unchanged = await window.syncEligible([original]);
  assert.equal(unchanged.attempts.length, 0);
  assert.equal(publishCalls, 1);

  now = "2026-09-11T10:05:00.000Z";
  const edited = workout("2026-09-11T10:04:00.000Z");
  const queued = await window.scan([edited]);
  assert.equal(queued[0]?.deliveryState, "queued");

  const retried = await window.syncEligible([edited]);
  assert.equal(retried.attempts.length, 1);
  assert.equal(publishCalls, 2);
  assert.equal(retried.items[0]?.deliveryState, "sent");
});
