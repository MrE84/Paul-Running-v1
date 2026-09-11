import { Pool } from "pg";
import type {
  TrainingPlan,
  TrainingPlanRevision,
  Workout,
  WorkoutRevision,
} from "../domain/contracts";
import {
  PostgresTrainingStore,
  type PostgresTrainingStoreOptions,
} from "./postgres-store";

/**
 * Adds a cross-instance entity lock around optimistic writes.
 *
 * The underlying PostgresTrainingStore performs the version check and write in one
 * transaction. This wrapper serializes competing writers for the same workout/plan
 * across Vercel instances so the second writer observes the committed newer version
 * and receives TrainingStoreVersionConflictError instead of overwriting it.
 */
export class SerializedPostgresTrainingStore extends PostgresTrainingStore {
  private readonly entityLockPool: Pool;

  constructor(private readonly serializedOptions: PostgresTrainingStoreOptions) {
    super(serializedOptions);
    this.entityLockPool = new Pool({
      connectionString: serializedOptions.connectionString,
      max: 2,
      ssl: serializedOptions.ssl === false ? undefined : { rejectUnauthorized: false },
    });
  }

  private async withEntityLock<T>(scope: string, entityId: string, operation: () => Promise<T>): Promise<T> {
    const client = await this.entityLockPool.connect();
    const key = `${scope}:${entityId}`;
    try {
      await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [key]);
      return await operation();
    } finally {
      try {
        await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]);
      } finally {
        client.release();
      }
    }
  }

  override async saveWorkout(workout: Workout, revision: WorkoutRevision): Promise<void> {
    return this.withEntityLock("workout", workout.id, () => super.saveWorkout(workout, revision));
  }

  override async savePlan(plan: TrainingPlan, revision: TrainingPlanRevision): Promise<void> {
    return this.withEntityLock("training-plan", plan.id, () => super.savePlan(plan, revision));
  }

  override async close(): Promise<void> {
    await Promise.all([super.close(), this.entityLockPool.end()]);
  }
}
