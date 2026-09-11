import type {
  ExternalActivityEnvelope,
  ExternalReference,
  IsoDateTime,
  SyncJob,
  UUID,
} from "../domain/contracts";

export interface IntegrationStateStore {
  findExternalReference(
    provider: string,
    entityType: string,
    entityId: UUID,
  ): Promise<ExternalReference | undefined>;

  findExternalReferenceByExternalId(
    provider: string,
    entityType: string,
    externalId: string,
  ): Promise<ExternalReference | undefined>;

  saveExternalReference(reference: ExternalReference): Promise<void>;

  findSyncJobByIdempotencyKey(idempotencyKey: string): Promise<SyncJob | undefined>;
  saveSyncJob(job: SyncJob): Promise<void>;
}

export interface ActivityImportSink {
  ingest(input: {
    athleteId: UUID;
    provider: string;
    activity: ExternalActivityEnvelope;
  }): Promise<{ activityId: UUID }>;
}

export interface ImportedActivityResult {
  externalId: string;
  activityId?: UUID;
  status: "imported" | "already_imported" | "failed";
  errorCode?: string;
  errorMessage?: string;
}

export interface ActivityImportBatchResult {
  items: ImportedActivityResult[];
  nextCursor?: string;
}

export interface IntegrationRuntime {
  idFactory: () => UUID;
  now: () => IsoDateTime;
}
