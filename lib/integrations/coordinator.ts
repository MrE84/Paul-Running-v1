import type {
  ActivityImportConnector,
  CalendarItem,
  CanonicalScheduledWorkout,
  ConnectorResult,
  ExternalReference,
  SyncJob,
  TrainingSyncConnector,
} from "../domain/contracts";
import type {
  ActivityImportBatchResult,
  ActivityImportSink,
  ImportedActivityResult,
  IntegrationRuntime,
  IntegrationStateStore,
} from "./contracts";

function retryAfterSeconds(result: Exclude<ConnectorResult, { ok: true }>): number | undefined {
  const value = result.providerMetadata?.retryAfterSeconds;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function syncKey(
  provider: string,
  operation: "publish" | "update" | "cancel",
  item: CalendarItem,
  workoutVersion?: number,
): string {
  return [
    provider,
    operation,
    "calendar_item",
    item.id,
    workoutVersion === undefined ? "-" : `v${workoutVersion}`,
    item.updatedAt,
  ].join(":");
}

export interface TrainingSyncCoordinatorConfig {
  connector: TrainingSyncConnector;
  state: IntegrationStateStore;
  runtime: IntegrationRuntime;
}

export class TrainingSyncCoordinator {
  private readonly connector: TrainingSyncConnector;
  private readonly state: IntegrationStateStore;
  private readonly runtime: IntegrationRuntime;

  constructor(config: TrainingSyncCoordinatorConfig) {
    this.connector = config.connector;
    this.state = config.state;
    this.runtime = config.runtime;
  }

  private newJob(input: {
    athleteId: string;
    entityId: string;
    entityVersion?: number;
    operation: "publish" | "update" | "cancel";
    idempotencyKey: string;
    now: string;
  }): SyncJob {
    return {
      id: this.runtime.idFactory(),
      athleteId: input.athleteId,
      provider: this.connector.provider,
      entityType: "calendar_item",
      entityId: input.entityId,
      entityVersion: input.entityVersion,
      operation: input.operation,
      state: "queued",
      idempotencyKey: input.idempotencyKey,
      attemptCount: 0,
      createdAt: input.now,
      updatedAt: input.now,
    };
  }

  async syncScheduledWorkout(input: CanonicalScheduledWorkout): Promise<ConnectorResult> {
    const existingReference = await this.state.findExternalReference(
      this.connector.provider,
      "calendar_item",
      input.calendarItem.id,
    );
    const operation = existingReference ? "update" : "publish";
    const idempotencyKey = syncKey(
      this.connector.provider,
      operation,
      input.calendarItem,
      input.workout.version,
    );
    const existingJob = await this.state.findSyncJobByIdempotencyKey(idempotencyKey);
    if (existingJob?.state === "succeeded" && existingReference) {
      return {
        ok: true,
        externalId: existingReference.externalId,
        externalUrl: existingReference.externalUrl,
        providerMetadata: {
          ...existingReference.providerMetadata,
          idempotentReplay: true,
        },
      };
    }

    const now = this.runtime.now();
    const job = existingJob ?? this.newJob({
      athleteId: input.athlete.id,
      entityId: input.calendarItem.id,
      entityVersion: input.workout.version,
      operation,
      idempotencyKey,
      now,
    });
    const runningJob: SyncJob = {
      ...job,
      state: "running",
      attemptCount: job.attemptCount + 1,
      nextAttemptAt: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      updatedAt: now,
    };
    await this.state.saveSyncJob(runningJob);

    const result = existingReference
      ? await this.connector.update(input, existingReference)
      : await this.connector.publish(input);
    const finishedAt = this.runtime.now();

    if (result.ok) {
      const reference: ExternalReference = {
        id: existingReference?.id ?? this.runtime.idFactory(),
        athleteId: input.athlete.id,
        entityType: "calendar_item",
        entityId: input.calendarItem.id,
        provider: this.connector.provider,
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        providerMetadata: result.providerMetadata ?? {},
        createdAt: existingReference?.createdAt ?? finishedAt,
        updatedAt: finishedAt,
      };
      await this.state.saveExternalReference(reference);
      await this.state.saveSyncJob({
        ...runningJob,
        state: "succeeded",
        updatedAt: finishedAt,
        completedAt: finishedAt,
      });
      return result;
    }

    const retrySeconds = retryAfterSeconds(result) ?? (result.kind === "retryable" ? 60 : undefined);
    await this.state.saveSyncJob({
      ...runningJob,
      state: result.kind === "retryable" ? "retryable_failure" : "permanent_failure",
      nextAttemptAt: retrySeconds === undefined ? undefined : addSeconds(finishedAt, retrySeconds),
      lastErrorCode: result.code,
      lastErrorMessage: result.message,
      updatedAt: finishedAt,
      completedAt: result.kind === "permanent" ? finishedAt : undefined,
    });
    return result;
  }

  async cancelCalendarItem(item: CalendarItem, athleteId: string): Promise<ConnectorResult> {
    const reference = await this.state.findExternalReference(
      this.connector.provider,
      "calendar_item",
      item.id,
    );
    if (!reference) {
      return {
        ok: true,
        externalId: "",
        providerMetadata: { alreadyAbsent: true, localOnly: true },
      };
    }

    const idempotencyKey = syncKey(this.connector.provider, "cancel", item);
    const existingJob = await this.state.findSyncJobByIdempotencyKey(idempotencyKey);
    if (existingJob?.state === "succeeded") {
      return {
        ok: true,
        externalId: reference.externalId,
        providerMetadata: { ...reference.providerMetadata, idempotentReplay: true },
      };
    }

    const now = this.runtime.now();
    const job = existingJob ?? this.newJob({
      athleteId,
      entityId: item.id,
      operation: "cancel",
      idempotencyKey,
      now,
    });
    const runningJob: SyncJob = {
      ...job,
      state: "running",
      attemptCount: job.attemptCount + 1,
      updatedAt: now,
    };
    await this.state.saveSyncJob(runningJob);
    const result = await this.connector.cancel(item, reference);
    const finishedAt = this.runtime.now();
    if (result.ok) {
      await this.state.saveSyncJob({
        ...runningJob,
        state: "succeeded",
        updatedAt: finishedAt,
        completedAt: finishedAt,
      });
      return result;
    }
    const retrySeconds = retryAfterSeconds(result) ?? (result.kind === "retryable" ? 60 : undefined);
    await this.state.saveSyncJob({
      ...runningJob,
      state: result.kind === "retryable" ? "retryable_failure" : "permanent_failure",
      nextAttemptAt: retrySeconds === undefined ? undefined : addSeconds(finishedAt, retrySeconds),
      lastErrorCode: result.code,
      lastErrorMessage: result.message,
      updatedAt: finishedAt,
      completedAt: result.kind === "permanent" ? finishedAt : undefined,
    });
    return result;
  }
}

export interface ActivityImportCoordinatorConfig {
  athleteId: string;
  connector: ActivityImportConnector;
  state: IntegrationStateStore;
  sink: ActivityImportSink;
  runtime: IntegrationRuntime;
}

export class ActivityImportCoordinator {
  private readonly athleteId: string;
  private readonly connector: ActivityImportConnector;
  private readonly state: IntegrationStateStore;
  private readonly sink: ActivityImportSink;
  private readonly runtime: IntegrationRuntime;

  constructor(config: ActivityImportCoordinatorConfig) {
    this.athleteId = config.athleteId;
    this.connector = config.connector;
    this.state = config.state;
    this.sink = config.sink;
    this.runtime = config.runtime;
  }

  async importNextPage(cursor?: string): Promise<ActivityImportBatchResult> {
    const page = await this.connector.listCompleted(cursor);
    const items: ImportedActivityResult[] = [];

    for (const summary of page.items) {
      const existing = await this.state.findExternalReferenceByExternalId(
        this.connector.provider,
        "activity",
        summary.externalId,
      );
      if (existing) {
        items.push({
          externalId: summary.externalId,
          activityId: existing.entityId,
          status: "already_imported",
        });
        continue;
      }

      const idempotencyKey = `${this.connector.provider}:import:activity:${summary.externalId}`;
      const now = this.runtime.now();
      const previousJob = await this.state.findSyncJobByIdempotencyKey(idempotencyKey);
      const runningJob: SyncJob = {
        id: previousJob?.id ?? this.runtime.idFactory(),
        athleteId: this.athleteId,
        provider: this.connector.provider,
        entityType: "activity",
        entityId: previousJob?.entityId ?? this.runtime.idFactory(),
        operation: "import",
        state: "running",
        idempotencyKey,
        attemptCount: (previousJob?.attemptCount ?? 0) + 1,
        createdAt: previousJob?.createdAt ?? now,
        updatedAt: now,
      };
      await this.state.saveSyncJob(runningJob);

      try {
        const detail = await this.connector.fetchActivity(summary.externalId);
        const ingested = await this.sink.ingest({
          athleteId: this.athleteId,
          provider: this.connector.provider,
          activity: detail,
        });
        const finishedAt = this.runtime.now();
        const reference: ExternalReference = {
          id: this.runtime.idFactory(),
          athleteId: this.athleteId,
          entityType: "activity",
          entityId: ingested.activityId,
          provider: this.connector.provider,
          externalId: detail.externalId,
          providerMetadata: {
            sourceFileUrl: detail.sourceFileUrl,
            startedAt: detail.startedAt,
          },
          createdAt: finishedAt,
          updatedAt: finishedAt,
        };
        await this.state.saveExternalReference(reference);
        await this.state.saveSyncJob({
          ...runningJob,
          entityId: ingested.activityId,
          state: "succeeded",
          updatedAt: finishedAt,
          completedAt: finishedAt,
        });
        items.push({
          externalId: detail.externalId,
          activityId: ingested.activityId,
          status: "imported",
        });
      } catch (error) {
        const finishedAt = this.runtime.now();
        const code = error instanceof Error ? error.name || "ACTIVITY_IMPORT_FAILED" : "ACTIVITY_IMPORT_FAILED";
        const message = error instanceof Error ? error.message : String(error);
        await this.state.saveSyncJob({
          ...runningJob,
          state: "retryable_failure",
          nextAttemptAt: addSeconds(finishedAt, 60),
          lastErrorCode: code,
          lastErrorMessage: message,
          updatedAt: finishedAt,
        });
        items.push({
          externalId: summary.externalId,
          status: "failed",
          errorCode: code,
          errorMessage: message,
        });
      }
    }

    return { items, nextCursor: page.nextCursor };
  }
}
