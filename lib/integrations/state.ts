import type { ExternalReference, SyncJob } from "../domain/contracts";
import type { IntegrationStateStore } from "./contracts";

function entityKey(provider: string, entityType: string, entityId: string): string {
  return `${provider}:${entityType}:entity:${entityId}`;
}

function externalKey(provider: string, entityType: string, externalId: string): string {
  return `${provider}:${entityType}:external:${externalId}`;
}

/**
 * Reference implementation used by tests and local development. Production
 * persistence should implement IntegrationStateStore against the canonical
 * external_references and sync_jobs tables defined in the database schema.
 */
export class InMemoryIntegrationStateStore implements IntegrationStateStore {
  private readonly referencesByEntity = new Map<string, ExternalReference>();
  private readonly referencesByExternalId = new Map<string, ExternalReference>();
  private readonly jobsByKey = new Map<string, SyncJob>();

  async findExternalReference(
    provider: string,
    entityType: string,
    entityId: string,
  ): Promise<ExternalReference | undefined> {
    return this.referencesByEntity.get(entityKey(provider, entityType, entityId));
  }

  async findExternalReferenceByExternalId(
    provider: string,
    entityType: string,
    externalId: string,
  ): Promise<ExternalReference | undefined> {
    return this.referencesByExternalId.get(externalKey(provider, entityType, externalId));
  }

  async saveExternalReference(reference: ExternalReference): Promise<void> {
    this.referencesByEntity.set(
      entityKey(reference.provider, reference.entityType, reference.entityId),
      reference,
    );
    this.referencesByExternalId.set(
      externalKey(reference.provider, reference.entityType, reference.externalId),
      reference,
    );
  }

  async findSyncJobByIdempotencyKey(idempotencyKey: string): Promise<SyncJob | undefined> {
    return this.jobsByKey.get(idempotencyKey);
  }

  async saveSyncJob(job: SyncJob): Promise<void> {
    this.jobsByKey.set(job.idempotencyKey, job);
  }

  listExternalReferences(): ExternalReference[] {
    return [...this.referencesByEntity.values()];
  }

  listSyncJobs(): SyncJob[] {
    return [...this.jobsByKey.values()];
  }
}
