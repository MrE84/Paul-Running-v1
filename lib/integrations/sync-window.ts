import type {
  CanonicalScheduledWorkout,
  ConnectorResult,
  ExternalReference,
  SyncJob,
} from "../domain/contracts";
import type { IntegrationRuntime, IntegrationStateStore } from "./contracts";
import { TrainingSyncCoordinator } from "./coordinator";

export type GarminDeliveryState = "planned" | "queued" | "sent" | "failed";

export interface RollingSyncWindowPolicy {
  /** Number of days ahead that are eligible for provider/Garmin delivery. */
  lookAheadDays: number;
  /** Grace period for a planned workout whose scheduled start has just passed. */
  lookBehindHours: number;
}

/**
 * Our observed Garmin/bridge behaviour is a near-term rolling window. Seven
 * days is the default policy, not a claim that Garmin guarantees this exact
 * horizon. It remains configurable so a provider-specific limit can change
 * without changing the canonical training plan.
 */
export const DEFAULT_GARMIN_SYNC_WINDOW_POLICY: RollingSyncWindowPolicy = {
  lookAheadDays: 7,
  lookBehindHours: 24,
};

export interface SyncWindowItem {
  calendarItemId: string;
  scheduledStart: string;
  eligible: boolean;
  deliveryState: GarminDeliveryState;
  reason:
    | "outside_window"
    | "eligible_unsent"
    | "sent_current"
    | "sync_failed"
    | "retry_wait"
    | "sync_running"
    | "not_planned"
    | "invalid_schedule";
  input: CanonicalScheduledWorkout;
  latestJob?: SyncJob;
  externalReference?: ExternalReference;
}

export interface SyncWindowRunResult {
  items: SyncWindowItem[];
  attempts: Array<{
    calendarItemId: string;
    result: ConnectorResult;
  }>;
}

export interface RollingSyncWindowServiceConfig {
  provider: string;
  coordinator: TrainingSyncCoordinator;
  state: IntegrationStateStore;
  runtime: IntegrationRuntime;
  policy?: Partial<RollingSyncWindowPolicy>;
}

function asTimestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite number greater than or equal to zero.`);
  }
  return value;
}

function jobMatchesWorkout(job: SyncJob | undefined, input: CanonicalScheduledWorkout): boolean {
  return job?.entityVersion === input.workout.version;
}

function currentDelivery(
  reference: ExternalReference | undefined,
  latestJob: SyncJob | undefined,
  input: CanonicalScheduledWorkout,
): boolean {
  if (!reference || latestJob?.state !== "succeeded" || !jobMatchesWorkout(latestJob, input)) {
    return false;
  }

  const deliveredAt = asTimestamp(reference.updatedAt);
  const sourceUpdatedAt = asTimestamp(input.calendarItem.updatedAt);
  if (deliveredAt === undefined || sourceUpdatedAt === undefined) return false;
  return deliveredAt >= sourceUpdatedAt;
}

export class RollingSyncWindowService {
  private readonly provider: string;
  private readonly coordinator: TrainingSyncCoordinator;
  private readonly state: IntegrationStateStore;
  private readonly runtime: IntegrationRuntime;
  readonly policy: RollingSyncWindowPolicy;

  constructor(config: RollingSyncWindowServiceConfig) {
    this.provider = config.provider;
    this.coordinator = config.coordinator;
    this.state = config.state;
    this.runtime = config.runtime;
    this.policy = {
      lookAheadDays: nonNegativeFinite(
        config.policy?.lookAheadDays ?? DEFAULT_GARMIN_SYNC_WINDOW_POLICY.lookAheadDays,
        "lookAheadDays",
      ),
      lookBehindHours: nonNegativeFinite(
        config.policy?.lookBehindHours ?? DEFAULT_GARMIN_SYNC_WINDOW_POLICY.lookBehindHours,
        "lookBehindHours",
      ),
    };
  }

  private async inspect(input: CanonicalScheduledWorkout, nowMs: number): Promise<SyncWindowItem> {
    const reference = await this.state.findExternalReference(
      this.provider,
      "calendar_item",
      input.calendarItem.id,
    );
    const latestJob = await this.state.findLatestSyncJob(
      this.provider,
      "calendar_item",
      input.calendarItem.id,
    );
    const scheduledMs = asTimestamp(input.calendarItem.scheduledStart);

    if (scheduledMs === undefined) {
      return {
        calendarItemId: input.calendarItem.id,
        scheduledStart: input.calendarItem.scheduledStart,
        eligible: false,
        deliveryState: "failed",
        reason: "invalid_schedule",
        input,
        latestJob,
        externalReference: reference,
      };
    }

    const current = currentDelivery(reference, latestJob, input);
    if (current) {
      return {
        calendarItemId: input.calendarItem.id,
        scheduledStart: input.calendarItem.scheduledStart,
        eligible: true,
        deliveryState: "sent",
        reason: "sent_current",
        input,
        latestJob,
        externalReference: reference,
      };
    }

    if (input.calendarItem.status !== "planned") {
      return {
        calendarItemId: input.calendarItem.id,
        scheduledStart: input.calendarItem.scheduledStart,
        eligible: false,
        deliveryState: "planned",
        reason: "not_planned",
        input,
        latestJob,
        externalReference: reference,
      };
    }

    const earliest = nowMs - this.policy.lookBehindHours * 60 * 60 * 1000;
    const latest = nowMs + this.policy.lookAheadDays * 24 * 60 * 60 * 1000;
    const eligible = scheduledMs >= earliest && scheduledMs <= latest;

    if (!eligible) {
      return {
        calendarItemId: input.calendarItem.id,
        scheduledStart: input.calendarItem.scheduledStart,
        eligible: false,
        deliveryState: "planned",
        reason: "outside_window",
        input,
        latestJob,
        externalReference: reference,
      };
    }

    if (jobMatchesWorkout(latestJob, input)) {
      if (latestJob?.state === "permanent_failure") {
        return {
          calendarItemId: input.calendarItem.id,
          scheduledStart: input.calendarItem.scheduledStart,
          eligible: true,
          deliveryState: "failed",
          reason: "sync_failed",
          input,
          latestJob,
          externalReference: reference,
        };
      }

      if (latestJob?.state === "retryable_failure") {
        const retryAt = latestJob.nextAttemptAt ? asTimestamp(latestJob.nextAttemptAt) : undefined;
        return {
          calendarItemId: input.calendarItem.id,
          scheduledStart: input.calendarItem.scheduledStart,
          eligible: true,
          deliveryState: "failed",
          reason: retryAt !== undefined && retryAt > nowMs ? "retry_wait" : "sync_failed",
          input,
          latestJob,
          externalReference: reference,
        };
      }

      if (latestJob?.state === "running") {
        return {
          calendarItemId: input.calendarItem.id,
          scheduledStart: input.calendarItem.scheduledStart,
          eligible: true,
          deliveryState: "queued",
          reason: "sync_running",
          input,
          latestJob,
          externalReference: reference,
        };
      }
    }

    return {
      calendarItemId: input.calendarItem.id,
      scheduledStart: input.calendarItem.scheduledStart,
      eligible: true,
      deliveryState: "queued",
      reason: "eligible_unsent",
      input,
      latestJob,
      externalReference: reference,
    };
  }

  /**
   * Returns one delivery projection for every canonical workout supplied. This
   * deliberately never truncates the plan to the provider/Garmin horizon.
   */
  async scan(inputs: readonly CanonicalScheduledWorkout[]): Promise<SyncWindowItem[]> {
    const nowMs = asTimestamp(this.runtime.now());
    if (nowMs === undefined) throw new Error("Integration runtime returned an invalid current time.");

    const inspected = await Promise.all(inputs.map((input) => this.inspect(input, nowMs)));
    return inspected.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  }

  /**
   * Re-evaluates the entire plan and attempts only workouts currently eligible
   * for delivery. Retryable failures are retried only when nextAttemptAt is due;
   * permanent failures require a source change or manual intervention.
   */
  async syncEligible(inputs: readonly CanonicalScheduledWorkout[]): Promise<SyncWindowRunResult> {
    const before = await this.scan(inputs);
    const nowMs = asTimestamp(this.runtime.now());
    if (nowMs === undefined) throw new Error("Integration runtime returned an invalid current time.");

    const attempts: SyncWindowRunResult["attempts"] = [];
    for (const item of before) {
      if (!item.eligible || item.reason === "sent_current" || item.reason === "sync_running") {
        continue;
      }

      const latestJob = item.latestJob;
      if (jobMatchesWorkout(latestJob, item.input)) {
        if (latestJob?.state === "permanent_failure") continue;
        if (latestJob?.state === "retryable_failure" && latestJob.nextAttemptAt) {
          const retryAt = asTimestamp(latestJob.nextAttemptAt);
          if (retryAt !== undefined && retryAt > nowMs) continue;
        }
      }

      const result = await this.coordinator.syncScheduledWorkout(item.input);
      attempts.push({ calendarItemId: item.calendarItemId, result });
    }

    return { items: await this.scan(inputs), attempts };
  }
}
