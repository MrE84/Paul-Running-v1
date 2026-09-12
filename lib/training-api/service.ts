import type {
  Activity,
  AuditEvent,
  Sport,
  TrainingPlan,
  TrainingPlanItem,
  TrainingPlanRevision,
  Workout,
  WorkoutRevision,
  WorkoutStep,
} from "../domain/contracts";
import { applyTrainingPlan } from "../calendar/apply-plan";
import { parseLocalDate, parseLocalTime, assertValidTimeZone } from "../calendar/timezone";
import type { IntegrationStateStore } from "../integrations/contracts";
import { validateWorkoutForSync } from "../qa";
import {
  TrainingStoreVersionConflictError,
  type PlanApplicationView,
  type ProfileView,
  type SyncStatusView,
  type TrainingApiActor,
  type TrainingApiRuntime,
  type TrainingApiStore,
  type WorkoutMutationResult,
} from "./contracts";

export class TrainingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "TrainingApiError";
  }
}

export interface CreateWorkoutInput {
  athleteId: string;
  name: string;
  description?: string;
  sport: Sport;
  steps: WorkoutStep[];
}

export interface PatchWorkoutInput {
  expectedVersion: number;
  change: Partial<Pick<WorkoutRevision, "name" | "description" | "sport" | "steps">>;
}

export interface CreatePlanInput {
  athleteId: string;
  name: string;
  description?: string;
  items: TrainingPlanItem[];
}

export interface ApplyPlanApiInput {
  planVersion: number;
  startDate: string;
  timezone: string;
  defaultLocalStartTime?: string;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
}

export class TrainingApiService {
  constructor(
    private readonly store: TrainingApiStore,
    private readonly runtime: TrainingApiRuntime,
    private readonly integrationState?: IntegrationStateStore,
    private readonly provider = "intervals_icu",
  ) {}

  private async requireAthlete(athleteId: string) {
    const athlete = await this.store.getAthlete(athleteId);
    if (!athlete) throw new TrainingApiError(404, "NOT_FOUND", `Athlete ${athleteId} was not found.`);
    return athlete;
  }

  private async qaContext(athleteId: string) {
    const now = this.runtime.now();
    const capacities = await this.store.listCapacities(athleteId);
    const zoneSets = await this.store.listZoneSets(athleteId);
    const active = <T extends { effectiveFrom: string; effectiveTo?: string }>(items: T[]) =>
      items.filter((item) => item.effectiveFrom <= now && (!item.effectiveTo || item.effectiveTo > now));
    return {
      capacity: active(capacities).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0],
      zoneSets: active(zoneSets),
    };
  }

  private async audit(actor: TrainingApiActor, action: string, entityType: string, entityId?: string, entityVersion?: number) {
    const event: AuditEvent = {
      id: this.runtime.idFactory(),
      actorType: actor.type,
      actorId: actor.id,
      action,
      entityType,
      entityId,
      entityVersion,
      requestId: actor.requestId,
      occurredAt: this.runtime.now(),
    };
    await this.store.appendAuditEvent(event);
  }

  private async persistWorkout(workout: Workout, revision: WorkoutRevision): Promise<void> {
    try {
      await this.store.saveWorkout(workout, revision);
    } catch (error) {
      if (error instanceof TrainingStoreVersionConflictError) {
        throw new TrainingApiError(409, "VERSION_CONFLICT", error.message, {
          currentVersion: error.currentVersion,
          expectedVersion: error.expectedVersion,
        });
      }
      throw error;
    }
  }

  private async idempotent<T>(actor: TrainingApiActor, action: string, input: unknown, operation: () => Promise<T>): Promise<T> {
    if (!actor.idempotencyKey) {
      throw new TrainingApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Write operations require an Idempotency-Key header.");
    }
    const key = `${actor.type}:${actor.id}:${action}:${actor.idempotencyKey}`;
    const fingerprint = stableSerialize(input);
    return this.store.withIdempotencyLock(key, async () => {
      const existing = await this.store.findIdempotency(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new TrainingApiError(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used with a different request.");
        }
        return existing.response as T;
      }
      const response = await operation();
      await this.store.saveIdempotency({ key, fingerprint, response, createdAt: this.runtime.now() });
      return response;
    });
  }

  async getProfile(athleteId: string): Promise<ProfileView> {
    const athlete = await this.requireAthlete(athleteId);
    const context = await this.qaContext(athleteId);
    return { athlete, currentCapacity: context.capacity, zoneSets: [...context.zoneSets] };
  }

  async listZones(athleteId: string) { await this.requireAthlete(athleteId); return this.store.listZoneSets(athleteId); }
  async listCalendar(athleteId: string, from?: string, to?: string) { await this.requireAthlete(athleteId); return this.store.listCalendarItems(athleteId, from, to); }
  async listActivities(athleteId: string, limit = 20) { await this.requireAthlete(athleteId); return this.store.listActivities(athleteId, limit); }
  async listWorkouts(athleteId: string) { await this.requireAthlete(athleteId); return this.store.listWorkouts(athleteId); }
  async listPlans(athleteId: string) { await this.requireAthlete(athleteId); return this.store.listPlans(athleteId); }
  async getWorkout(id: string) { const item = await this.store.getWorkout(id); if (!item) throw new TrainingApiError(404, "NOT_FOUND", `Workout ${id} was not found.`); return item; }
  async getPlan(id: string) { const item = await this.store.getPlan(id); if (!item) throw new TrainingApiError(404, "NOT_FOUND", `Training plan ${id} was not found.`); return item; }

  async validateWorkout(id: string) {
    const workout = await this.getWorkout(id);
    return validateWorkoutForSync({ workout: workout.currentRevision, context: await this.qaContext(workout.athleteId) });
  }

  async createWorkout(input: CreateWorkoutInput, actor: TrainingApiActor): Promise<WorkoutMutationResult> {
    return this.idempotent(actor, "create_workout", input, async () => {
      await this.requireAthlete(input.athleteId);
      const now = this.runtime.now();
      const id = this.runtime.idFactory();
      const revision: WorkoutRevision = {
        workoutId: id,
        version: 1,
        name: input.name,
        description: input.description,
        sport: input.sport,
        steps: input.steps,
        createdAt: now,
        createdByActor: actor.type,
      };
      const qa = validateWorkoutForSync({ workout: revision, context: await this.qaContext(input.athleteId) });
      if (!qa.valid) throw new TrainingApiError(422, "WORKOUT_QA_FAILED", "Workout failed QA and was not persisted.", qa.findings);
      const workout: Workout = { id, athleteId: input.athleteId, currentVersion: 1, currentRevision: revision, createdAt: now, updatedAt: now };
      await this.persistWorkout(workout, revision);
      await this.audit(actor, "workout.created", "workout", id, 1);
      return { workout, qa };
    });
  }

  async patchWorkout(id: string, input: PatchWorkoutInput, actor: TrainingApiActor): Promise<WorkoutMutationResult> {
    return this.idempotent(actor, `patch_workout:${id}`, input, async () => {
      const current = await this.getWorkout(id);
      if (current.currentVersion !== input.expectedVersion) {
        throw new TrainingApiError(409, "VERSION_CONFLICT", `Expected workout version ${input.expectedVersion}, current version is ${current.currentVersion}.`, { currentVersion: current.currentVersion });
      }
      const now = this.runtime.now();
      const revision: WorkoutRevision = {
        ...current.currentRevision,
        ...input.change,
        workoutId: id,
        version: current.currentVersion + 1,
        createdAt: now,
        createdByActor: actor.type,
      };
      const qa = validateWorkoutForSync({ workout: revision, context: await this.qaContext(current.athleteId) });
      if (!qa.valid) throw new TrainingApiError(422, "WORKOUT_QA_FAILED", "Workout revision failed QA and was not persisted.", qa.findings);
      const workout: Workout = { ...current, currentVersion: revision.version, currentRevision: revision, updatedAt: now };
      await this.persistWorkout(workout, revision);
      await this.audit(actor, "workout.revised", "workout", id, revision.version);
      return { workout, qa };
    });
  }

  private async validatePlanItems(athleteId: string, items: TrainingPlanItem[]) {
    const ids = new Set<string>();
    const sequences = new Set<number>();
    for (const item of items) {
      if (ids.has(item.id) || sequences.has(item.sequence)) throw new TrainingApiError(400, "VALIDATION_FAILED", "Plan item IDs and sequence values must be unique.");
      ids.add(item.id); sequences.add(item.sequence);
      if (!Number.isInteger(item.sequence) || item.sequence < 0 || !Number.isInteger(item.dayOffset) || item.dayOffset < 0) throw new TrainingApiError(400, "VALIDATION_FAILED", `Plan item ${item.id} has an invalid sequence or dayOffset.`);
      if (item.localStartTime) parseLocalTime(item.localStartTime);
      const workout = await this.store.getWorkoutRevision(item.workoutId, item.workoutVersion);
      if (!workout) throw new TrainingApiError(400, "VALIDATION_FAILED", `Plan item ${item.id} references missing workout ${item.workoutId} v${item.workoutVersion}.`);
      const owner = await this.store.getWorkout(item.workoutId);
      if (!owner || owner.athleteId !== athleteId) throw new TrainingApiError(403, "FORBIDDEN", `Workout ${item.workoutId} does not belong to athlete ${athleteId}.`);
      const qa = validateWorkoutForSync({ workout, context: await this.qaContext(athleteId) });
      if (!qa.valid) throw new TrainingApiError(422, "WORKOUT_QA_FAILED", `Plan item ${item.id} references a workout that fails QA.`, qa.findings);
    }
  }

  async createPlan(input: CreatePlanInput, actor: TrainingApiActor): Promise<TrainingPlan> {
    return this.idempotent(actor, "create_plan", input, async () => {
      await this.requireAthlete(input.athleteId);
      await this.validatePlanItems(input.athleteId, input.items);
      const now = this.runtime.now(); const id = this.runtime.idFactory();
      const revision: TrainingPlanRevision = { planId: id, version: 1, name: input.name, description: input.description, items: input.items, createdAt: now, createdByActor: actor.type };
      const plan: TrainingPlan = { id, athleteId: input.athleteId, currentVersion: 1, currentRevision: revision, createdAt: now, updatedAt: now };
      await this.store.savePlan(plan, revision);
      await this.audit(actor, "training_plan.created", "training_plan", id, 1);
      return plan;
    });
  }

  async applyPlan(planId: string, input: ApplyPlanApiInput, actor: TrainingApiActor): Promise<PlanApplicationView> {
    return this.idempotent(actor, `apply_plan:${planId}`, input, async () => {
      parseLocalDate(input.startDate); assertValidTimeZone(input.timezone); if (input.defaultLocalStartTime) parseLocalTime(input.defaultLocalStartTime);
      const plan = await this.getPlan(planId);
      const revision = await this.store.getPlanRevision(planId, input.planVersion);
      if (!revision) throw new TrainingApiError(404, "NOT_FOUND", `Plan ${planId} revision ${input.planVersion} was not found.`);
      await this.validatePlanItems(plan.athleteId, revision.items);
      const workouts = new Map<string, WorkoutRevision>();
      for (const item of revision.items) {
        const workout = await this.store.getWorkoutRevision(item.workoutId, item.workoutVersion);
        if (workout) workouts.set(`${item.workoutId}@${item.workoutVersion}`, workout);
      }
      let result;
      try {
        result = applyTrainingPlan({ athleteId: plan.athleteId, plan: revision, workouts, startDate: input.startDate, timezone: input.timezone, defaultLocalStartTime: input.defaultLocalStartTime }, { idFactory: () => this.runtime.idFactory(), now: () => this.runtime.now(), actor: actor.type });
      } catch (error) {
        throw new TrainingApiError(400, "VALIDATION_FAILED", error instanceof Error ? error.message : "Plan application failed validation.");
      }
      await this.store.savePlanApplication(result.application, result.calendarItems);
      await this.audit(actor, "training_plan.applied", "training_plan", planId, revision.version);
      return result;
    });
  }

  async supersedeCalendarItem(calendarItemId: string, actor: TrainingApiActor) {
    return this.idempotent(actor, `supersede_calendar_item:${calendarItemId}`, { calendarItemId }, async () => {
      const current = await this.store.getCalendarItem(calendarItemId);
      if (!current) throw new TrainingApiError(404, "NOT_FOUND", `Calendar item ${calendarItemId} was not found.`);
      if (current.status === "superseded") return current;
      if (current.status !== "planned") {
        throw new TrainingApiError(409, "CALENDAR_ITEM_NOT_SUPERSEDEABLE", `Only planned calendar items can be superseded; current status is ${current.status}.`);
      }
      const externalReference = await this.integrationState?.findExternalReference(this.provider, "calendar_item", calendarItemId);
      if (externalReference) {
        throw new TrainingApiError(409, "CALENDAR_ITEM_ALREADY_SENT", "This calendar item already has an external delivery reference and cannot be superseded without canceling the provider event first.");
      }
      const updated = { ...current, status: "superseded" as const, updatedAt: this.runtime.now() };
      await this.store.saveCalendarItem(updated);
      await this.audit(actor, "calendar_item.superseded", "calendar_item", calendarItemId, current.workout.version);
      return updated;
    });
  }

  async getSyncStatus(calendarItemId: string): Promise<SyncStatusView> {
    const calendarItem = await this.store.getCalendarItem(calendarItemId);
    if (!calendarItem) throw new TrainingApiError(404, "NOT_FOUND", `Calendar item ${calendarItemId} was not found.`);
    const latestJob = await this.integrationState?.findLatestSyncJob(this.provider, "calendar_item", calendarItemId);
    const externalReference = await this.integrationState?.findExternalReference(this.provider, "calendar_item", calendarItemId);
    const state: SyncStatusView["state"] = latestJob?.state === "succeeded" && externalReference ? "sent" : latestJob?.state === "retryable_failure" || latestJob?.state === "permanent_failure" ? "failed" : latestJob ? "queued" : "planned";
    return { calendarItem, provider: this.provider, state, latestJob, externalReference };
  }

  async ingestActivity(activity: Activity) { await this.store.saveActivity(activity); }
  async auditEvents() { return this.store.listAuditEvents(); }
}
