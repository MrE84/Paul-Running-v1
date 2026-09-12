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
 * Adds cross-instance entity serialization to the durable PostgreSQL store.
 *
 * The inherited withIdempotencyLock() uses pg_advisory_xact_lock inside the
 * PostgresTrainingStore request transaction. Calling the base save method from
 * inside that lock reuses the same AsyncLocalStorage-bound PoolClient, so the
 * entity lock, optimistic version check and write all execute on one database
 * transaction/session. This remains safe behind Neon/PgBouncer transaction pooling.
 */
export class SerializedPostgresTrainingStore extends PostgresTrainingStore {
  constructor(options: PostgresTrainingStoreOptions) {
    super(options);
  }

  override async saveWorkout(workout: Workout, revision: WorkoutRevision): Promise<void> {
    return this.withIdempotencyLock(`entity:workout:${workout.id}`, () =>
      super.saveWorkout(workout, revision),
    );
  }

  override async savePlan(plan: TrainingPlan, revision: TrainingPlanRevision): Promise<void> {
    return this.withIdempotencyLock(`entity:training-plan:${plan.id}`, () =>
      super.savePlan(plan, revision),
    );
  }
}
