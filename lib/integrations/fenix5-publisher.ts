import { localDateTimeToUtc } from "../calendar/timezone";
import type {
  Athlete,
  CanonicalScheduledWorkout,
  ConnectorResult,
} from "../domain/contracts";
import { assertWorkoutReadyForSync } from "../qa/engine";
import { buildWorkout } from "../workouts/builder";
import {
  createFenix5ValidationTemplates,
  type Fenix5ValidationTemplate,
  type Fenix5ValidationTemplateConfig,
} from "./fenix5-validation";
import { TrainingSyncCoordinator } from "./coordinator";
import { InMemoryIntegrationStateStore } from "./state";
import { RollingSyncWindowService, type SyncWindowItem } from "./sync-window";
import {
  IntervalsIcuClient,
  type IntervalsIcuAuth,
  type IntervalsIcuEventPayload,
} from "./intervals-icu/client";
import { IntervalsIcuTrainingConnector } from "./intervals-icu/connector";
import { translateScheduledWorkout } from "./intervals-icu/translation";

export interface Fenix5LiveValidationInput {
  templateId: string;
  localDate: string;
  localTime: string;
  timezone?: string;
  templateConfig: Fenix5ValidationTemplateConfig;
  sourceVersion?: number;
}

export interface Fenix5ValidationDryRun {
  templateId: string;
  templateName: string;
  scheduledStart: string;
  timezone: string;
  event: IntervalsIcuEventPayload;
  warnings: string[];
}

export interface Fenix5LivePublishConfig {
  auth: IntervalsIcuAuth;
  athleteId?: string;
  now?: () => string;
  idFactory?: () => string;
  fetchImpl?: typeof fetch;
}

export interface Fenix5LivePublishResult {
  dryRun: Fenix5ValidationDryRun;
  attempted: boolean;
  result?: ConnectorResult;
  delivery?: SyncWindowItem;
}

function idFactory(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

function validationTemplate(
  templateId: string,
  config: Fenix5ValidationTemplateConfig,
): Fenix5ValidationTemplate {
  const template = createFenix5ValidationTemplates(config).find((item) => item.id === templateId);
  if (!template) {
    throw new Error(
      `Unknown Fenix 5 validation template: ${templateId}. Choose one of: ${createFenix5ValidationTemplates(config)
        .map((item) => item.id)
        .join(", ")}.`,
    );
  }
  return template;
}

function canonicalInput(
  input: Fenix5LiveValidationInput,
  now: string,
  stepIdFactory: () => string,
): { template: Fenix5ValidationTemplate; scheduled: CanonicalScheduledWorkout } {
  const timezone = input.timezone ?? "Europe/London";
  const scheduledStart = localDateTimeToUtc(input.localDate, input.localTime, timezone);
  const template = validationTemplate(input.templateId, input.templateConfig);
  const version = input.sourceVersion ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("sourceVersion must be a positive integer.");
  }

  const workoutId = `validation-workout-${template.id}`;
  const calendarItemId = `validation-${template.id}-${input.localDate}`;
  const workout = buildWorkout(
    {
      workoutId,
      version,
      name: template.name,
      sport: "running",
      steps: template.preset.steps,
      createdAt: now,
      createdByActor: "user",
    },
    { idFactory: stepIdFactory },
  ).workout;

  const athlete: Athlete = {
    id: "validation-athlete",
    displayName: "Fenix 5 validation",
    timezone,
    createdAt: now,
    updatedAt: now,
  };

  return {
    template,
    scheduled: {
      athlete,
      calendarItem: {
        id: calendarItemId,
        athleteId: athlete.id,
        workout: { id: workoutId, version },
        scheduledStart,
        timezone,
        status: "planned",
        createdAt: now,
        updatedAt: now,
      },
      workout,
    },
  };
}

export function prepareFenix5LiveValidation(
  input: Fenix5LiveValidationInput,
  options: { now?: string; idFactory?: () => string } = {},
): Fenix5ValidationDryRun {
  const now = options.now ?? new Date().toISOString();
  const prepared = canonicalInput(
    input,
    now,
    options.idFactory ?? idFactory("validation-step"),
  );
  const translation = translateScheduledWorkout(
    prepared.scheduled,
    prepared.template.translationConfig,
  );

  assertWorkoutReadyForSync({
    workout: prepared.scheduled.workout,
    context: {
      calendarItem: {
        ...prepared.scheduled.calendarItem,
        planApplicationId: "fenix5-live-validation",
        scheduledLocalDate: translation.localDate,
        scheduledLocalTime: translation.localTime,
      },
      deliveryProfile: translation.deliveryProfile,
      syncProjection: translation.syncProjection,
    },
  });

  return {
    templateId: prepared.template.id,
    templateName: prepared.template.name,
    scheduledStart: prepared.scheduled.calendarItem.scheduledStart,
    timezone: prepared.scheduled.calendarItem.timezone,
    event: translation.event,
    warnings: translation.warnings,
  };
}

export async function publishFenix5LiveValidation(
  input: Fenix5LiveValidationInput,
  config: Fenix5LivePublishConfig,
): Promise<Fenix5LivePublishResult> {
  const now = config.now?.() ?? new Date().toISOString();
  const runtimeIdFactory = config.idFactory ?? idFactory("validation-runtime");
  const prepared = canonicalInput(input, now, idFactory("validation-step"));
  const dryRun = prepareFenix5LiveValidation(input, {
    now,
    idFactory: idFactory("validation-step"),
  });

  const client = new IntervalsIcuClient({
    auth: config.auth,
    athleteId: config.athleteId ?? "0",
    fetchImpl: config.fetchImpl,
  });
  const connector = new IntervalsIcuTrainingConnector({
    client,
    ...prepared.template.translationConfig,
  });
  const state = new InMemoryIntegrationStateStore();
  const runtime = {
    idFactory: runtimeIdFactory,
    now: () => now,
  };
  const coordinator = new TrainingSyncCoordinator({ connector, state, runtime });
  const window = new RollingSyncWindowService({
    provider: connector.provider,
    coordinator,
    state,
    runtime,
  });

  const run = await window.syncEligible([prepared.scheduled]);
  const delivery = run.items[0];
  const attempt = run.attempts[0];
  return {
    dryRun,
    attempted: Boolean(attempt),
    result: attempt?.result,
    delivery,
  };
}
