import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import type { Athlete } from "../domain/contracts";
import type { TrainingApiActor, TrainingApiRuntime } from "./contracts";
import { SerializedPostgresTrainingStore } from "./serialized-postgres-store";
import { TrainingApiError, TrainingApiService, type CreateWorkoutInput } from "./service";

function connectionForSchema(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const searchPathOption = `-csearch_path=${schema}`;
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", existing ? `${existing} ${searchPathOption}` : searchPathOption);
  return url.toString();
}

function runtime(prefix: string, now: string): TrainingApiRuntime {
  let sequence = 0;
  return {
    now: () => now,
    idFactory: () => `${prefix}-${++sequence}-${randomUUID()}`,
  };
}

const databaseUrl = process.env.DATABASE_URL_UNPOOLED?.trim();

test(
  "PostgreSQL API serializes duplicate commands and competing version writes across store instances",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);

    const schema = `pau16_test_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const admin = new Pool({
      connectionString: databaseUrl,
      max: 1,
      ssl: { rejectUnauthorized: false },
    });

    await admin.query(`create schema "${schema}"`);
    const isolatedUrl = connectionForSchema(databaseUrl, schema);
    const createdAt = "2026-09-12T14:00:00.000Z";
    const athlete: Athlete = {
      id: "durable-test-athlete",
      displayName: "Durable Test Athlete",
      timezone: "Europe/London",
      createdAt,
      updatedAt: createdAt,
    };

    const storeA = new SerializedPostgresTrainingStore({
      connectionString: isolatedUrl,
      seedAthlete: athlete,
      maxConnections: 2,
    });
    const storeB = new SerializedPostgresTrainingStore({
      connectionString: isolatedUrl,
      seedAthlete: athlete,
      maxConnections: 2,
    });
    const serviceA = new TrainingApiService(storeA, runtime("a", createdAt), storeA);
    const serviceB = new TrainingApiService(storeB, runtime("b", createdAt), storeB);

    try {
      const seeded = await storeA.getAthlete(athlete.id);
      assert.equal(seeded?.createdAt, createdAt);
      const fromSecondInstance = await storeB.getAthlete(athlete.id);
      assert.equal(fromSecondInstance?.createdAt, createdAt);

      const createInput: CreateWorkoutInput = {
        athleteId: athlete.id,
        name: "Durable concurrency workout",
        sport: "running",
        steps: [
          {
            id: "step-1",
            kind: "step",
            sequence: 0,
            phase: "active",
            durationType: "time",
            durationValue: 600,
            durationUnit: "seconds",
            targetType: "none",
          },
        ],
      };
      const actorA: TrainingApiActor = {
        type: "ai_client",
        id: "concurrency-test-client",
        requestId: "create-a",
        idempotencyKey: "same-create-command",
      };
      const actorB: TrainingApiActor = {
        ...actorA,
        requestId: "create-b",
      };

      const [createdA, createdB] = await Promise.all([
        serviceA.createWorkout(createInput, actorA),
        serviceB.createWorkout(createInput, actorB),
      ]);

      assert.equal(createdA.workout.id, createdB.workout.id);
      assert.equal(createdA.workout.currentVersion, 1);
      assert.equal((await storeB.listWorkouts(athlete.id)).length, 1);

      const patchA: TrainingApiActor = {
        type: "ai_client",
        id: "concurrency-test-client",
        requestId: "patch-a",
        idempotencyKey: "patch-a",
      };
      const patchB: TrainingApiActor = {
        ...patchA,
        requestId: "patch-b",
        idempotencyKey: "patch-b",
      };

      const competingWrites = await Promise.allSettled([
        serviceA.patchWorkout(
          createdA.workout.id,
          { expectedVersion: 1, change: { name: "Writer A" } },
          patchA,
        ),
        serviceB.patchWorkout(
          createdA.workout.id,
          { expectedVersion: 1, change: { name: "Writer B" } },
          patchB,
        ),
      ]);

      const fulfilled = competingWrites.filter((result) => result.status === "fulfilled");
      const rejected = competingWrites.filter((result) => result.status === "rejected");
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(rejected[0].status === "rejected" && rejected[0].reason instanceof TrainingApiError);
      if (rejected[0].status === "rejected" && rejected[0].reason instanceof TrainingApiError) {
        assert.equal(rejected[0].reason.status, 409);
        assert.equal(rejected[0].reason.code, "VERSION_CONFLICT");
      }

      const persistedWorkout = await storeA.getWorkout(createdA.workout.id);
      assert.equal(persistedWorkout?.currentVersion, 2);
    } finally {
      await Promise.allSettled([storeA.close(), storeB.close()]);
      await admin.query(`drop schema if exists "${schema}" cascade`);
      await admin.end();
    }
  },
);
