import type {
  ActorType,
  CanonicalScheduledWorkout,
  CapacityRevision,
  ConnectorResult,
  ExternalReference,
  SyncJob,
} from "../domain/contracts";
import type { WorkoutQaContext } from "../qa/contracts";
import type { TrainingApiStore } from "../training-api/contracts";
import type { IntegrationRuntime, IntegrationStateStore } from "./contracts";
import { TrainingSyncCoordinator } from "./coordinator";
import { IntervalsIcuClient } from "./intervals-icu/client";
import { IntervalsIcuTrainingConnector } from "./intervals-icu/connector";
import {
  RollingSyncWindowService,
  type GarminDeliveryState,
  type RollingSyncWindowPolicy,
  type SyncWindowItem,
} from "./sync-window";

export interface ProductionWorkoutPublisherConfig {
  store: TrainingApiStore;
  state: IntegrationStateStore;
  runtime: IntegrationRuntime;
  apiKey: string;
  intervalsAthleteId?: string;
  fetchImpl?: typeof fetch;
  policy?: Partial<RollingSyncWindowPolicy>;
}

export interface WorkoutPublishActor {
  actorType: ActorType;
  actorId?: string;
  requestId?: string;
}

export interface ProductionWorkoutPublishResult {
  provider: "intervals_icu";
  calendarItemId: string;
  scheduledStart: string;
  eligible: boolean;
  attempted: boolean;
  deliveryState: GarminDeliveryState;
  reason: SyncWindowItem["reason"];
  externalId?: string;
  externalReference?: ExternalReference;
  latestJob?: SyncJob;
  result?: ConnectorResult;
}

export class ProductionWorkoutPublishError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ProductionWorkoutPublishError";
  }
}

function activeAt<T extends { effectiveFrom: string; effectiveTo?: string }>(
  items: T[],
  now: string,
): T[] {
  return items.filter(
    (item) => item.effectiveFrom <= now && (!item.effectiveTo || item.effectiveTo > now),
  );
}

function heartRateAnchor(capacity: CapacityRevision | undefined) {
  if (capacity?.lt2HrBpm && capacity.lt2HrBpm > 0) {
    return { type: "lthr" as const, bpm: capacity.lt2HrBpm };
  }
  if (capacity?.maxHrBpm && capacity.maxHrBpm > 0) {
    return { type: "max_hr" as const, bpm: capacity.maxHrBpm };
  }
  return undefined;
}

export class ProductionWorkoutPublisher {
  private readonly store: TrainingApiStore;
  private readonly state: IntegrationStateStore;
  private readonly runtime: IntegrationRuntime;
  private readonly client: IntervalsIcuClient;
  private readonly policy?: Partial<RollingSyncWindowPolicy>;

  constructor(config: ProductionWorkoutPublisherConfig) {
    this.store = config.store;
    this.state = config.state;
    this.runtime = config.runtime;
    this.policy = config.policy;
    this.client = new IntervalsIcuClient({
      auth: { type: "api_key", apiKey: config.apiKey },
      athleteId: config.intervalsAthleteId ?? "0",
      fetchImpl: config.fetchImpl,
    });
  }

  private async canonicalInput(calendarItemId: string): Promise<CanonicalScheduledWorkout> {
    const calendarItem = await this.store.getCalendarItem(calendarItemId);
    if (!calendarItem) {
      throw new ProductionWorkoutPublishError(
        404,
        "CALENDAR_ITEM_NOT_FOUND",
        `Calendar item ${calendarItemId} was not found.`,
      );
    }

    const athlete = await this.store.getAthlete(calendarItem.athleteId);
    if (!athlete) {
      throw new ProductionWorkoutPublishError(
        409,
        "CALENDAR_ITEM_ATHLETE_MISSING",
        `Calendar item ${calendarItemId} references missing athlete ${calendarItem.athleteId}.`,
      );
    }

    const owner = await this.store.getWorkout(calendarItem.workout.id);
    const workout = await this.store.getWorkoutRevision(
      calendarItem.workout.id,
      calendarItem.workout.version,
    );
    if (!owner || owner.athleteId !== athlete.id || !workout) {
      throw new ProductionWorkoutPublishError(
        409,
        "CALENDAR_ITEM_WORKOUT_MISSING",
        `Calendar item ${calendarItemId} references unavailable workout ${calendarItem.workout.id} v${calendarItem.workout.version}.`,
      );
    }

    return { athlete, calendarItem, workout };
  }

  private async qaContext(athleteId: string): Promise<WorkoutQaContext> {
    const now = this.runtime.now();
    const [capacities, zoneSets] = await Promise.all([
      this.store.listCapacities(athleteId),
      this.store.listZoneSets(athleteId),
    ]);
    const capacity = activeAt(capacities, now).sort((a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom),
    )[0];
    return {
      capacity,
      zoneSets: activeAt(zoneSets, now),
    };
  }

  async publishCalendarItem(
    calendarItemId: string,
    actor?: WorkoutPublishActor,
  ): Promise<ProductionWorkoutPublishResult> {
    const input = await this.canonicalInput(calendarItemId);
    const sourceLock = [
      "intervals_icu",
      "publish",
      "calendar_item",
      input.calendarItem.id,
      `v${input.workout.version}`,
      input.calendarItem.updatedAt,
    ].join(":");

    return this.store.withIdempotencyLock(sourceLock, async () => {
      const qaContext = await this.qaContext(input.athlete.id);
      const connector = new IntervalsIcuTrainingConnector({
        client: this.client,
        ...(heartRateAnchor(qaContext.capacity)
          ? { heartRateAnchor: heartRateAnchor(qaContext.capacity) }
          : {}),
        qaContextFactory: () => qaContext,
      });
      const coordinator = new TrainingSyncCoordinator({
        connector,
        state: this.state,
        runtime: this.runtime,
      });
      const window = new RollingSyncWindowService({
        provider: connector.provider,
        coordinator,
        state: this.state,
        runtime: this.runtime,
        ...(this.policy ? { policy: this.policy } : {}),
      });

      const run = await window.syncEligible([input]);
      const projection = run.items[0];
      if (!projection) {
        throw new ProductionWorkoutPublishError(
          500,
          "SYNC_PROJECTION_MISSING",
          `No delivery projection was produced for calendar item ${calendarItemId}.`,
        );
      }
      const attempt = run.attempts.find((item) => item.calendarItemId === calendarItemId);
      const connectorResult = attempt?.result;
      const externalId = connectorResult?.ok
        ? connectorResult.externalId
        : projection.externalReference?.externalId;

      if (actor) {
        await this.store.appendAuditEvent({
          id: this.runtime.idFactory(),
          athleteId: input.athlete.id,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: "calendar_item.publish_evaluated",
          entityType: "calendar_item",
          entityId: input.calendarItem.id,
          entityVersion: input.workout.version,
          requestId: actor.requestId,
          occurredAt: this.runtime.now(),
        });
      }

      return {
        provider: "intervals_icu",
        calendarItemId,
        scheduledStart: projection.scheduledStart,
        eligible: projection.eligible,
        attempted: Boolean(attempt),
        deliveryState: projection.deliveryState,
        reason: projection.reason,
        externalId,
        externalReference: projection.externalReference,
        latestJob: projection.latestJob,
        result: connectorResult,
      };
    });
  }
}
