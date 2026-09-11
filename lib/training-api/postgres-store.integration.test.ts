import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { Athlete, Workout, WorkoutRevision } from "../domain/contracts";
import { TrainingStoreVersionConflictError } from "./contracts";
import { SerializedPostgresTrainingStore } from "./serialized-postgres-store";

function connectionForSchema(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const searchPathOption = `-csearch_path=${schema}`;
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", existing ? `${existing} ${searchPathOption}` : searchPathOption);
  return url.toString();
}

const databaseUrl = process.env.DATABASE_URL?.trim();

test(
  "PostgreSQL adapter persists across store instances and serializes idempotency/version conflicts",
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
    const createdAt = "2026-09-11T12:00:00.000Z";
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

    try {
      const seeded = await storeA.getAthlete(athlete.id);
      assert.equal(seeded?.createdAt, createdAt);

      const fromSecondInstance = await storeB.getAthlete(athlete.id);
      assert.equal(fromSecondInstance?.createdAt, createdAt);

      const idempotencyKey = `integration-${randomUUID()}`;
      let commandExecutions = 0;
      const command = async (store: SerializedPostgresTrainingStore, winner: string) =>
        store.withIdempotencyLock(idempotencyKey, async () => {
          const existing = await store.findIdempotency(idempotencyKey);
          if (existing) return existing.response;

          commandExecutions += 1;
          await new Promise((resolve) => setTimeout(resolve, 75));
          const response = { winner };
          await store.saveIdempotency({
            key: idempotencyKey,
            fingerprint: "same-command",
            response,
            createdAt,
          });
          return response;
        });

      const [firstResult, secondResult] = await Promise.all([
        command(storeA, "A"),
        command(storeB, "B"),
      ]);
      assert.deepEqual(firstResult, secondResult);
      assert.equal(commandExecutions, 1);

      const revision1: WorkoutRevision = {
        workoutId: "durable-workout",
        version: 1,
        name: "Durable workout",
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
        createdAt,
        createdByActor: "system",
      };
      const workout1: Workout = {
        id: revision1.workoutId,
        athleteId: athlete.id,
        currentVersion: 1,
        currentRevision: revision1,
        createdAt,
        updatedAt: createdAt,
      };
      await storeA.saveWorkout(workout1, revision1);

      const revision2A: WorkoutRevision = {
        ...revision1,
        version: 2,
        name: "Writer A",
        createdAt: "2026-09-11T12:01:00.000Z",
      };
      const revision2B: WorkoutRevision = {
        ...revision1,
        version: 2,
        name: "Writer B",
        createdAt: "2026-09-11T12:01:01.000Z",
      };
      const workout2A: Workout = {
        ...workout1,
        currentVersion: 2,
        currentRevision: revision2A,
        updatedAt: revision2A.createdAt,
      };
      const workout2B: Workout = {
        ...workout1,
        currentVersion: 2,
        currentRevision: revision2B,
        updatedAt: revision2B.createdAt,
      };

      const competingWrites = await Promise.allSettled([
        storeA.saveWorkout(workout2A, revision2A),
        storeB.saveWorkout(workout2B, revision2B),
      ]);
      const fulfilled = competingWrites.filter((result) => result.status === "fulfilled");
      const rejected = competingWrites.filter((result) => result.status === "rejected");

      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(
        rejected[0].status === "rejected" && rejected[0].reason instanceof TrainingStoreVersionConflictError,
      );

      const persistedWorkout = await storeB.getWorkout(workout1.id);
      assert.equal(persistedWorkout?.currentVersion, 2);
    } finally {
      await Promise.allSettled([storeA.close(), storeB.close()]);
      await admin.query(`drop schema if exists "${schema}" cascade`);
      await admin.end();
    }
  },
);
