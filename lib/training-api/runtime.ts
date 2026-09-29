import { randomUUID } from "node:crypto";
import type { Athlete } from "../domain/contracts";
import { ProductionActivityImporter } from "../integrations/production-activity-importer";
import { ProductionWorkoutPublisher } from "../integrations/production-publisher";
import { InMemoryIntegrationStateStore } from "../integrations/state";
import { IntervalsZoneSync } from "../integrations/intervals-icu/zone-sync";
import { IntervalsIcuClient, type IntervalsIcuActivityStream } from "../integrations/intervals-icu/client";
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
  activityImportConfigured: boolean;
  workoutPublisher?: ProductionWorkoutPublisher;
  activityImporter?: ProductionActivityImporter;
  zoneSync?: IntervalsZoneSync;
  providerStreams?: ProviderStreamReader;
}

/** Read-only access to Intervals.icu activity streams (PAU-47 verification). */
export interface ProviderStreamReader {
  getActivityStreams(providerActivityId: string): Promise<IntervalsIcuActivityStream[]>;
}

const globalRuntime = globalThis as typeof globalThis & {
  __paulRunningTrainingApi?: TrainingApiRuntimeBundle;
};

function intervalsApiKey(): string | undefined {
  const value = process.env.INTERVALS_ICU_API_KEY?.trim();
  return value || undefined;
}

function productionPublisher(
  store: TrainingApiStore,
  state: IntegrationStateStore,
  runtime: IntegrationRuntime,
  apiKey: string | undefined,
): ProductionWorkoutPublisher | undefined {
  if (!apiKey) return undefined;
  return new ProductionWorkoutPublisher({
    store,
    state,
    runtime,
    apiKey,
    intervalsAthleteId: process.env.INTERVALS_ICU_ATHLETE_ID?.trim() || "0",
  });
}

function intervalsZoneSync(apiKey: string | undefined): IntervalsZoneSync | undefined {
  if (!apiKey) return undefined;
  return new IntervalsZoneSync({
    apiKey,
    intervalsAthleteId: process.env.INTERVALS_ICU_ATHLETE_ID?.trim() || "0",
  });
}

function providerStreamReader(apiKey: string | undefined): ProviderStreamReader | undefined {
  if (!apiKey) return undefined;
  const client = new IntervalsIcuClient({
    auth: { type: "api_key", apiKey },
    athleteId: process.env.INTERVALS_ICU_ATHLETE_ID?.trim() || "0",
  });
  return {
    getActivityStreams: async (providerActivityId) => (await client.getActivityStreams(providerActivityId)).data,
  };
}

function productionActivityImporter(
  store: TrainingApiStore,
  state: IntegrationStateStore,
  runtime: IntegrationRuntime,
  apiKey: string | undefined,
  athleteId: string,
): ProductionActivityImporter | undefined {
  if (!apiKey) return undefined;
  return new ProductionActivityImporter({
    store,
    state,
    runtime,
    apiKey,
    athleteId,
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
  const apiKey = intervalsApiKey();

  if (connectionString) {
    const store = new SerializedPostgresTrainingStore({
      connectionString,
      seedAthlete: athlete,
      maxConnections: 4,
    });
    const service = new TrainingApiService(store, runtime, store);
    const workoutPublisher = productionPublisher(store, store, runtime, apiKey);
    const activityImporter = productionActivityImporter(
      store,
      store,
      runtime,
      apiKey,
      primaryAthleteId,
    );
    globalRuntime.__paulRunningTrainingApi = {
      service,
      primaryAthleteId,
      storageMode: "postgres",
      intervalsIcuConfigured: Boolean(apiKey),
      activityImportConfigured: Boolean(activityImporter),
      workoutPublisher,
      activityImporter,
      zoneSync: intervalsZoneSync(apiKey),
      providerStreams: providerStreamReader(apiKey),
    };
    return globalRuntime.__paulRunningTrainingApi;
  }

  const store = new InMemoryTrainingApiStore({ athletes: [athlete] });
  const integrationState = new InMemoryIntegrationStateStore();
  const service = new TrainingApiService(store, runtime, integrationState);
  const workoutPublisher = productionPublisher(store, integrationState, runtime, apiKey);
  const activityImporter = productionActivityImporter(
    store,
    integrationState,
    runtime,
    apiKey,
    primaryAthleteId,
  );
  globalRuntime.__paulRunningTrainingApi = {
    service,
    primaryAthleteId,
    storageMode: "memory_reference",
    intervalsIcuConfigured: Boolean(apiKey),
    activityImportConfigured: Boolean(activityImporter),
    workoutPublisher,
    activityImporter,
    zoneSync: intervalsZoneSync(apiKey),
    providerStreams: providerStreamReader(apiKey),
  };
  return globalRuntime.__paulRunningTrainingApi;
}
