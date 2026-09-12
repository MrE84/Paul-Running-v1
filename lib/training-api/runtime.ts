import { randomUUID } from "node:crypto";
import type { Athlete } from "../domain/contracts";
import { ProductionWorkoutPublisher } from "../integrations/production-publisher";
import { InMemoryIntegrationStateStore } from "../integrations/state";
import type { IntegrationRuntime, IntegrationStateStore } from "../integrations/contracts";
import { SerializedPostgresTrainingStore } from "./serialized-postgres-store";
import type { TrainingApiStore } from "./contracts";
import { TrainingApiService } from "./service";
import { InMemoryTrainingApiStore } from "./store";

export type TrainingApiStorageMode = "memory_reference" | "postgres";

export interface TrainingApiRuntimeBundle {
  service: TrainingApiService;
  primaryAthleteId: string;
  storageMode: TrainingApiStorageMode;
  intervalsIcuConfigured: boolean;
  workoutPublisher?: ProductionWorkoutPublisher;
}

const globalRuntime = globalThis as typeof globalThis & {
  __paulRunningTrainingApi?: TrainingApiRuntimeBundle;
};

function productionPublisher(
  store: TrainingApiStore,
  state: IntegrationStateStore,
  runtime: IntegrationRuntime,
): ProductionWorkoutPublisher | undefined {
  const apiKey = process.env.INTERVALS_ICU_API_KEY?.trim();
  if (!apiKey) return undefined;
  return new ProductionWorkoutPublisher({
    store,
    state,
    runtime,
    apiKey,
    intervalsAthleteId: process.env.INTERVALS_ICU_ATHLETE_ID?.trim() || "0",
  });
}

export function getTrainingApiRuntime(): TrainingApiRuntimeBundle {
  if (globalRuntime.__paulRunningTrainingApi) return globalRuntime.__paulRunningTrainingApi;

  const now = new Date().toISOString();
  const primaryAthleteId = process.env.PAUL_RUNNING_PRIMARY_ATHLETE_ID ?? "primary-athlete";
  const athlete: Athlete = {
    id: primaryAthleteId,
    displayName: process.env.PAUL_RUNNING_PRIMARY_ATHLETE_NAME ?? "Primary athlete",
    timezone: process.env.PAUL_RUNNING_TIMEZONE ?? "Europe/London",
    createdAt: now,
    updatedAt: now,
  };
  const runtime: IntegrationRuntime = {
    idFactory: () => randomUUID(),
    now: () => new Date().toISOString(),
  };
  const connectionString = process.env.DATABASE_URL?.trim();

  if (connectionString) {
    const store = new SerializedPostgresTrainingStore({
      connectionString,
      seedAthlete: athlete,
      maxConnections: 4,
    });
    const service = new TrainingApiService(store, runtime, store);
    const workoutPublisher = productionPublisher(store, store, runtime);
    globalRuntime.__paulRunningTrainingApi = {
      service,
      primaryAthleteId,
      storageMode: "postgres",
      intervalsIcuConfigured: Boolean(workoutPublisher),
      workoutPublisher,
    };
    return globalRuntime.__paulRunningTrainingApi;
  }

  const store = new InMemoryTrainingApiStore({ athletes: [athlete] });
  const integrationState = new InMemoryIntegrationStateStore();
  const service = new TrainingApiService(store, runtime, integrationState);
  const workoutPublisher = productionPublisher(store, integrationState, runtime);
  globalRuntime.__paulRunningTrainingApi = {
    service,
    primaryAthleteId,
    storageMode: "memory_reference",
    intervalsIcuConfigured: Boolean(workoutPublisher),
    workoutPublisher,
  };
  return globalRuntime.__paulRunningTrainingApi;
}
