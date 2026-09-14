import type {
  ActivityImportConnector,
  ActivityImportPage,
  CalendarItem,
  CanonicalScheduledWorkout,
  ConnectorFailure,
  ConnectorResult,
  ExternalActivityEnvelope,
  ExternalReference,
  Sport,
  TrainingSyncConnector,
} from "../../domain/contracts";
import type { ScheduledCalendarItem } from "../../calendar/contracts";
import type { WorkoutQaContext } from "../../qa/contracts";
import { assertWorkoutReadyForSync, WorkoutQaError } from "../../qa/engine";
import {
  IntervalsIcuClient,
  IntervalsIcuHttpError,
  intervalsEventHasParsedWorkout,
  type IntervalsIcuActivityResponse,
} from "./client";
import {
  IntervalsIcuTranslationError,
  translateScheduledWorkout,
  type IntervalsIcuTranslationConfig,
} from "./translation";

export interface IntervalsIcuTrainingConnectorConfig extends IntervalsIcuTranslationConfig {
  client: IntervalsIcuClient;
  qaContextFactory?: (input: CanonicalScheduledWorkout) => WorkoutQaContext;
}

function providerFailure(error: unknown): ConnectorFailure {
  if (error instanceof WorkoutQaError) {
    return {
      ok: false,
      kind: "permanent",
      code: "WORKOUT_QA_FAILED",
      message: error.message,
      providerMetadata: { findings: error.report.findings },
    };
  }
  if (error instanceof IntervalsIcuTranslationError) {
    return {
      ok: false,
      kind: "permanent",
      code: error.code,
      message: error.message,
      providerMetadata: { path: error.path },
    };
  }
  if (error instanceof IntervalsIcuHttpError) {
    const retryable = error.status === 0 || error.status === 429 || error.status >= 500;
    return {
      ok: false,
      kind: retryable ? "retryable" : "permanent",
      code:
        error.status === 429
          ? "RATE_LIMITED"
          : error.status === 0
            ? "NETWORK_ERROR"
            : `HTTP_${error.status}`,
      message: error.message,
      providerMetadata: {
        status: error.status,
        retryAfterSeconds: error.retryAfterSeconds,
        rateLimit: error.rateLimit,
        responseBody: error.responseBody,
      },
    };
  }
  return {
    ok: false,
    kind: "retryable",
    code: "INTERVALS_ICU_UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

function qaCalendarItem(
  input: CanonicalScheduledWorkout,
  localDate: string,
  localTime: string,
): ScheduledCalendarItem {
  return {
    ...input.calendarItem,
    planApplicationId: input.calendarItem.sourcePlan?.id ?? "standalone-sync",
    scheduledLocalDate: localDate,
    scheduledLocalTime: localTime,
  };
}

export class IntervalsIcuTrainingConnector implements TrainingSyncConnector {
  readonly provider = "intervals_icu";
  private readonly config: IntervalsIcuTrainingConnectorConfig;

  constructor(config: IntervalsIcuTrainingConnectorConfig) {
    this.config = config;
  }

  private async upsert(input: CanonicalScheduledWorkout): Promise<ConnectorResult> {
    try {
      const translation = translateScheduledWorkout(input, this.config);
      const customContext = this.config.qaContextFactory?.(input) ?? {};
      assertWorkoutReadyForSync({
        workout: input.workout,
        context: {
          ...customContext,
          calendarItem: qaCalendarItem(input, translation.localDate, translation.localTime),
          deliveryProfile: translation.deliveryProfile,
          syncProjection: translation.syncProjection,
        },
      });

      const response = await this.config.client.upsertEvents([translation.event]);
      const event = response.data[0];
      if (!event?.id) {
        return {
          ok: false,
          kind: "retryable",
          code: "INTERVALS_ICU_MISSING_EVENT_ID",
          message: "Intervals.icu accepted the workout but did not return an event ID.",
          providerMetadata: { response: response.data },
        };
      }

      // Intervals.icu may accept a description yet fail to parse it into structured
      // device-syncable workout steps. When the provider includes workout_doc in
      // the upsert response, treat an empty steps array as a permanent publication
      // failure rather than reporting a false success. A follow-up read can verify
      // older/provider responses that omit workout_doc entirely.
      if (event.workout_doc && !intervalsEventHasParsedWorkout(event)) {
        return {
          ok: false,
          kind: "permanent",
          code: "INTERVALS_ICU_WORKOUT_NOT_PARSED",
          message: "Intervals.icu stored the workout event but did not parse its description into structured workout steps.",
          providerMetadata: {
            externalId: String(event.id),
            externalKey: translation.event.external_id,
            renderedDescription: translation.event.description,
            workoutDoc: event.workout_doc,
            rateLimit: response.rateLimit,
          },
        };
      }

      return {
        ok: true,
        externalId: String(event.id),
        providerMetadata: {
          externalKey: translation.event.external_id,
          renderedDescription: translation.event.description,
          startDateLocal: translation.event.start_date_local,
          warnings: translation.warnings,
          ...(event.workout_doc ? { workoutParsed: true } : {}),
          rateLimit: response.rateLimit,
        },
      };
    } catch (error) {
      return providerFailure(error);
    }
  }

  publish(input: CanonicalScheduledWorkout): Promise<ConnectorResult> {
    return this.upsert(input);
  }

  update(
    input: CanonicalScheduledWorkout,
    _externalReference: ExternalReference,
  ): Promise<ConnectorResult> {
    // Bulk upsert uses Paul's Running external_id as the durable idempotency key,
    // so publish and update intentionally share the same provider operation.
    return this.upsert(input);
  }

  async cancel(
    _item: CalendarItem,
    externalReference: ExternalReference,
  ): Promise<ConnectorResult> {
    try {
      const response = await this.config.client.deleteEvent(externalReference.externalId);
      return {
        ok: true,
        externalId: externalReference.externalId,
        providerMetadata: { rateLimit: response.rateLimit, deleted: true },
      };
    } catch (error) {
      if (error instanceof IntervalsIcuHttpError && error.status === 404) {
        return {
          ok: true,
          externalId: externalReference.externalId,
          providerMetadata: { deleted: true, alreadyAbsent: true },
        };
      }
      return providerFailure(error);
    }
  }
}

function sportFromIntervals(type: string | undefined): Sport {
  const normalized = (type ?? "").toLowerCase();
  if (normalized.includes("run")) return "running";
  if (normalized.includes("ride") || normalized.includes("bike") || normalized.includes("cycle")) {
    return "cycling";
  }
  if (normalized.includes("walk") || normalized.includes("hike")) return "walking";
  return "other";
}

function activityEnvelope(
  client: IntervalsIcuClient,
  activity: IntervalsIcuActivityResponse,
): ExternalActivityEnvelope {
  if (activity.id === undefined || activity.id === null) {
    throw new Error("Intervals.icu activity response is missing id.");
  }
  const externalId = String(activity.id);
  const startedAt = activity.start_date ?? activity.start_date_local;
  if (!startedAt) {
    throw new Error(`Intervals.icu activity ${externalId} is missing start_date.`);
  }
  return {
    externalId,
    startedAt,
    sport: sportFromIntervals(activity.type),
    sourceFileUrl: client.activityFileUrl(externalId),
    sourceMetadata: activity,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid activity cursor date: ${dateString}`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export interface IntervalsIcuActivityConnectorConfig {
  client: IntervalsIcuClient;
  defaultLookbackDays?: number;
  pageDays?: number;
  now?: () => Date;
}

export class IntervalsIcuActivityImportConnector implements ActivityImportConnector {
  readonly provider = "intervals_icu";
  private readonly client: IntervalsIcuClient;
  private readonly defaultLookbackDays: number;
  private readonly pageDays: number;
  private readonly now: () => Date;

  constructor(config: IntervalsIcuActivityConnectorConfig) {
    this.client = config.client;
    this.defaultLookbackDays = config.defaultLookbackDays ?? 30;
    this.pageDays = config.pageDays ?? 14;
    this.now = config.now ?? (() => new Date());
  }

  async listCompleted(cursor?: string): Promise<ActivityImportPage> {
    const today = isoDate(this.now());
    const tomorrow = addDays(today, 1);
    const oldest = cursor ?? addDays(today, -this.defaultLookbackDays);
    const proposedNewest = addDays(oldest, this.pageDays);
    const newest = proposedNewest < tomorrow ? proposedNewest : tomorrow;
    const response = await this.client.listActivities({ oldest, newest });
    const items = response.data.map((activity) => activityEnvelope(this.client, activity));
    return {
      items,
      // Reuse the boundary date as the next oldest date. This one-day overlap is
      // deliberate because Intervals.icu date-range edge behavior has changed
      // over time; external-ID dedupe makes overlap safe while avoiding misses.
      nextCursor: newest < tomorrow ? newest : undefined,
    };
  }

  async fetchActivity(externalId: string): Promise<ExternalActivityEnvelope> {
    const response = await this.client.getActivity(externalId);
    return activityEnvelope(this.client, response.data);
  }
}
