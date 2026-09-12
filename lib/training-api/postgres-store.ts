import { AsyncLocalStorage } from "node:async_hooks";
import { activityListItem, type ActivityListItem, type ProjectionCacheEntry } from "../activity-analysis/projection";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  Activity,
  Athlete,
  AuditEvent,
  CapacityRevision,
  ExternalReference,
  SyncJob,
  TrainingPlan,
  TrainingPlanRevision,
  Workout,
  WorkoutRevision,
  ZoneSet,
} from "../domain/contracts";
import type { IntegrationStateStore } from "../integrations/contracts";
import type { PlanApplication, ScheduledCalendarItem } from "../calendar/contracts";
import {
  TrainingStoreVersionConflictError,
  type IdempotencyRecord,
  type TrainingApiStore,
} from "./contracts";

interface DocumentRow extends QueryResultRow {
  payload: unknown;
}

interface CountRow extends QueryResultRow {
  count: string;
}

export interface PostgresTrainingStoreOptions {
  connectionString: string;
  seedAthlete: Athlete;
  maxConnections?: number;
  ssl?: boolean;
}

function sortBy<T>(items: T[], selector: (item: T) => string, direction: "asc" | "desc" = "asc"): T[] {
  return items.sort((a, b) => {
    const left = selector(a);
    const right = selector(b);
    const comparison = left.localeCompare(right);
    return direction === "asc" ? comparison : -comparison;
  });
}

/**
 * Durable PostgreSQL adapter for both PAU-15 repository ports.
 *
 * Domain objects are persisted as JSON documents so the API/domain contract stays stable
 * while the normalized PAU-7 schema can evolve independently. Transactions use a request-
 * scoped PoolClient so idempotency locks and the writes they guard run on the same connection.
 */
export class PostgresTrainingStore implements TrainingApiStore, IntegrationStateStore {
  private readonly pool: Pool;
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly options: PostgresTrainingStoreOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 4,
      ssl: options.ssl === false ? undefined : { rejectUnauthorized: false },
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Bootstrap the small PAU-16 document repository lazily on first use. This keeps builds
   * safe before DATABASE_URL exists and means a newly provisioned Vercel/Neon database is
   * usable without a separate manual SQL step. The checked-in SQL migration remains the
   * authoritative migration record.
   */
  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool
        .query(`
          create table if not exists training_api_documents (
            kind text not null,
            entity_id text not null,
            athlete_id text,
            sort_key timestamptz,
            payload jsonb not null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            primary key (kind, entity_id)
          );

          create index if not exists training_api_documents_athlete_kind_idx
            on training_api_documents (athlete_id, kind, sort_key desc nulls last);

          create index if not exists training_api_documents_payload_gin_idx
            on training_api_documents using gin (payload jsonb_path_ops);

          create table if not exists training_api_idempotency (
            key text primary key,
            fingerprint text not null,
            response jsonb not null,
            created_at timestamptz not null default now()
          );
        `)
        .then(() => undefined)
        .catch((error) => {
          this.schemaReady = null;
          throw error;
        });
    }
    return this.schemaReady;
  }

  private async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
    await this.ensureSchema();
    const client = this.transactionClient.getStore();
    return client ? client.query<T>(text, values) : this.pool.query<T>(text, values);
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    if (this.transactionClient.getStore()) return operation();
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await this.transactionClient.run(client, operation);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async withIdempotencyLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    return this.transaction(async () => {
      await this.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      return operation();
    });
  }

  private async read<T>(kind: string, entityId: string): Promise<T | undefined> {
    const result = await this.query<DocumentRow>(
      "select payload from training_api_documents where kind = $1 and entity_id = $2",
      [kind, entityId],
    );
    return result.rows[0]?.payload as T | undefined;
  }

  private async list<T>(kind: string, athleteId?: string): Promise<T[]> {
    const result = athleteId
      ? await this.query<DocumentRow>(
          "select payload from training_api_documents where kind = $1 and athlete_id = $2 order by sort_key asc nulls last, entity_id asc",
          [kind, athleteId],
        )
      : await this.query<DocumentRow>(
          "select payload from training_api_documents where kind = $1 order by sort_key asc nulls last, entity_id asc",
          [kind],
        );
    return result.rows.map((row) => row.payload as T);
  }

  private async write(
    kind: string,
    entityId: string,
    athleteId: string | undefined,
    payload: unknown,
    sortKey?: string,
  ): Promise<void> {
    await this.query(
      `insert into training_api_documents(kind, entity_id, athlete_id, sort_key, payload)
       values ($1, $2, $3, $4::timestamptz, $5::jsonb)
       on conflict (kind, entity_id) do update
       set athlete_id = excluded.athlete_id,
           sort_key = excluded.sort_key,
           payload = excluded.payload,
           updated_at = now()`,
      [kind, entityId, athleteId ?? null, sortKey ?? null, JSON.stringify(payload)],
    );
  }

  async getAthlete(id: string): Promise<Athlete | undefined> {
    const existing = await this.read<Athlete>("athlete", id);
    if (existing) return existing;
    if (id !== this.options.seedAthlete.id) return undefined;
    await this.write("athlete", id, id, this.options.seedAthlete, this.options.seedAthlete.createdAt);
    return this.options.seedAthlete;
  }

  async listCapacities(athleteId: string): Promise<CapacityRevision[]> {
    return sortBy(await this.list<CapacityRevision>("capacity", athleteId), (item) => item.effectiveFrom);
  }

  async listZoneSets(athleteId: string): Promise<ZoneSet[]> {
    return sortBy(await this.list<ZoneSet>("zone_set", athleteId), (item) => item.effectiveFrom);
  }

  async listWorkouts(athleteId: string): Promise<Workout[]> {
    return (await this.list<Workout>("workout", athleteId)).sort((a, b) => a.id.localeCompare(b.id));
  }

  async getWorkout(id: string): Promise<Workout | undefined> {
    return this.read<Workout>("workout", id);
  }

  async getWorkoutRevision(id: string, version: number): Promise<WorkoutRevision | undefined> {
    return this.read<WorkoutRevision>("workout_revision", `${id}@${version}`);
  }

  async saveWorkout(workout: Workout, revision: WorkoutRevision): Promise<void> {
    await this.transaction(async () => {
      const existing = await this.getWorkout(workout.id);
      if (revision.version === 1) {
        if (existing && existing.currentVersion !== 1) {
          throw new TrainingStoreVersionConflictError(workout.id, 0, existing.currentVersion);
        }
      } else {
        const expectedPrevious = revision.version - 1;
        if (!existing || existing.currentVersion !== expectedPrevious) {
          throw new TrainingStoreVersionConflictError(
            workout.id,
            expectedPrevious,
            existing?.currentVersion ?? 0,
          );
        }
      }
      await this.write(
        "workout_revision",
        `${revision.workoutId}@${revision.version}`,
        workout.athleteId,
        revision,
        revision.createdAt,
      );
      await this.write("workout", workout.id, workout.athleteId, workout, workout.updatedAt);
    });
  }

  async listPlans(athleteId: string): Promise<TrainingPlan[]> {
    return (await this.list<TrainingPlan>("training_plan", athleteId)).sort((a, b) => a.id.localeCompare(b.id));
  }

  async getPlan(id: string): Promise<TrainingPlan | undefined> {
    return this.read<TrainingPlan>("training_plan", id);
  }

  async getPlanRevision(id: string, version: number): Promise<TrainingPlanRevision | undefined> {
    return this.read<TrainingPlanRevision>("training_plan_revision", `${id}@${version}`);
  }

  async savePlan(plan: TrainingPlan, revision: TrainingPlanRevision): Promise<void> {
    await this.transaction(async () => {
      const existing = await this.getPlan(plan.id);
      if (revision.version > 1) {
        const expectedPrevious = revision.version - 1;
        if (!existing || existing.currentVersion !== expectedPrevious) {
          throw new TrainingStoreVersionConflictError(plan.id, expectedPrevious, existing?.currentVersion ?? 0);
        }
      }
      await this.write(
        "training_plan_revision",
        `${revision.planId}@${revision.version}`,
        plan.athleteId,
        revision,
        revision.createdAt,
      );
      await this.write("training_plan", plan.id, plan.athleteId, plan, plan.updatedAt);
    });
  }

  async listCalendarItems(athleteId: string, from?: string, to?: string): Promise<ScheduledCalendarItem[]> {
    return (await this.list<ScheduledCalendarItem>("calendar_item", athleteId))
      .filter((item) => !from || item.scheduledStart >= from)
      .filter((item) => !to || item.scheduledStart <= to)
      .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  }

  async getCalendarItem(id: string): Promise<ScheduledCalendarItem | undefined> {
    return this.read<ScheduledCalendarItem>("calendar_item", id);
  }

  async saveCalendarItem(item: ScheduledCalendarItem): Promise<void> {
    await this.write("calendar_item", item.id, item.athleteId, item, item.scheduledStart);
  }

  async savePlanApplication(application: PlanApplication, items: ScheduledCalendarItem[]): Promise<void> {
    await this.transaction(async () => {
      await this.write(
        "plan_application",
        application.id,
        application.athleteId,
        application,
        application.appliedAt,
      );
      for (const item of items) {
        await this.write("calendar_item", item.id, item.athleteId, item, item.scheduledStart);
      }
    });
  }

  async listActivities(athleteId: string, limit = 20): Promise<Activity[]> {
    return sortBy(await this.list<Activity>("activity", athleteId), (item) => item.startedAt, "desc").slice(
      0,
      Math.max(0, limit),
    );
  }

  async saveActivity(activity: Activity): Promise<void> {
    await this.write("activity", activity.id, activity.athleteId, activity, activity.startedAt);
  }

  async listActivitySummaries(athleteId: string, limit = 20): Promise<ActivityListItem[]> {
    const result = await this.query<DocumentRow>(
      `select payload - 'normalizedData' as payload from training_api_documents
       where kind = 'activity' and athlete_id = $1
       order by sort_key desc nulls last, entity_id asc limit $2`,
      [athleteId, Math.max(0, Math.min(100, limit))],
    );
    return result.rows.map(row => activityListItem(row.payload as Omit<Activity, "normalizedData">));
  }

  async getActivity(id: string): Promise<Activity | undefined> { return this.read<Activity>("activity", id); }
  async getAnalysisCache(id: string): Promise<ProjectionCacheEntry | undefined> { return this.read<ProjectionCacheEntry>("activity_analysis", id); }
  async saveAnalysisCache(id: string, athleteId: string, entry: ProjectionCacheEntry): Promise<void> {
    await this.write("activity_analysis", id, athleteId, entry);
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    await this.write("audit_event", event.id, event.athleteId, event, event.occurredAt);
  }

  async listAuditEvents(): Promise<AuditEvent[]> {
    return sortBy(await this.list<AuditEvent>("audit_event"), (item) => item.occurredAt);
  }

  async findIdempotency(key: string): Promise<IdempotencyRecord | undefined> {
    const result = await this.query<QueryResultRow & { key: string; fingerprint: string; response: unknown; created_at: Date | string }>(
      "select key, fingerprint, response, created_at from training_api_idempotency where key = $1",
      [key],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      key: row.key,
      fingerprint: row.fingerprint,
      response: row.response,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    };
  }

  async saveIdempotency(record: IdempotencyRecord): Promise<void> {
    await this.query(
      `insert into training_api_idempotency(key, fingerprint, response, created_at)
       values ($1, $2, $3::jsonb, $4::timestamptz)
       on conflict (key) do nothing`,
      [record.key, record.fingerprint, JSON.stringify(record.response), record.createdAt],
    );
  }

  async findExternalReference(provider: string, entityType: string, entityId: string): Promise<ExternalReference | undefined> {
    return this.read<ExternalReference>(`external_reference:${provider}:${entityType}`, entityId);
  }

  async findExternalReferenceByExternalId(provider: string, entityType: string, externalId: string): Promise<ExternalReference | undefined> {
    const result = await this.query<DocumentRow>(
      `select payload from training_api_documents
       where kind = $1 and payload ->> 'externalId' = $2
       order by updated_at desc limit 1`,
      [`external_reference:${provider}:${entityType}`, externalId],
    );
    return result.rows[0]?.payload as ExternalReference | undefined;
  }

  async saveExternalReference(reference: ExternalReference): Promise<void> {
    await this.write(
      `external_reference:${reference.provider}:${reference.entityType}`,
      reference.entityId,
      reference.athleteId,
      reference,
      reference.updatedAt,
    );
  }

  async findSyncJobByIdempotencyKey(idempotencyKey: string): Promise<SyncJob | undefined> {
    const result = await this.query<DocumentRow>(
      `select payload from training_api_documents
       where kind = 'sync_job' and payload ->> 'idempotencyKey' = $1
       order by updated_at desc limit 1`,
      [idempotencyKey],
    );
    return result.rows[0]?.payload as SyncJob | undefined;
  }

  async findLatestSyncJob(provider: string, entityType: string, entityId: string): Promise<SyncJob | undefined> {
    const result = await this.query<DocumentRow>(
      `select payload from training_api_documents
       where kind = 'sync_job'
         and payload ->> 'provider' = $1
         and payload ->> 'entityType' = $2
         and payload ->> 'entityId' = $3
       order by sort_key desc nulls last, updated_at desc limit 1`,
      [provider, entityType, entityId],
    );
    return result.rows[0]?.payload as SyncJob | undefined;
  }

  async saveSyncJob(job: SyncJob): Promise<void> {
    await this.write("sync_job", job.id, job.athleteId, job, job.updatedAt);
  }

  async countDocuments(kind: string): Promise<number> {
    const result = await this.query<CountRow>(
      "select count(*)::text as count from training_api_documents where kind = $1",
      [kind],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
