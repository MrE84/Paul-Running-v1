import { randomUUID } from "node:crypto";
import type { Athlete } from "../domain/contracts";
import { InMemoryIntegrationStateStore } from "../integrations/state";
import { SerializedPostgresTrainingStore } from "./serialized-postgres-store";
import { TrainingApiService } from "./service";
import { InMemoryTrainingApiStore } from "./store";

export type TrainingApiStorageMode = "memory_reference" | "postgres";

export interface TrainingApiRuntimeBundle {
  service: TrainingApiService;
  primaryAthleteId: string;
  storageMode: TrainingApiStorageMode;
}

const globalRuntime = globalThis as typeof globalThis & {
  __paulRunningTrainingApi?: TrainingApiRuntimeBundle;
};

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

  const connectionString = process.env.DATABASE_URL?.trim();

  if (connectionString) {
    const store = new SerializedPostgresTrainingStore({
      connectionString,
      seedAthlete: athlete,
      maxConnections: 4,
    });
    const service = new TrainingApiService(
      store,
      { idFactory: () => randomUUID(), now: () => new Date().toISOString() },
      store,
    );
    globalRuntime.__paulRunningTrainingApi = {
      service,
      primaryAthleteId,
      storageMode: "postgres",
    };
    return globalRuntime.__paulRunningTrainingApi;
  }

  const store = new InMemoryTrainingApiStore({ athletes: [athlete] });
  const integrationState = new InMemoryIntegrationStateStore();
  const service = new TrainingApiService(
    store,
    { idFactory: () => randomUUID(), now: () => new Date().toISOString() },
    integrationState,
  );
  globalRuntime.__paulRunningTrainingApi = {
    service,
    primaryAthleteId,
    storageMode: "memory_reference",
  };
  return globalRuntime.__paulRunningTrainingApi;
}
