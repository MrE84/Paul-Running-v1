import { createHash } from "node:crypto";
import type {
  ActorType,
  CalendarItem,
  Sport,
  WorkoutExecutionStep,
  WorkoutStep,
  WorkoutStepPhase,
} from "../domain/contracts";
import type { TrainingApiActor } from "../training-api/contracts";
import type { TrainingApiService } from "../training-api/service";
import scheduledWorkoutsJson from "../training-programme/scheduled-workouts.json";

type ProviderWorkoutStep = {
  type: "WorkoutStep" | "WorkoutRepeatStep";
  stepOrder?: number;
  intensity?: string;
  description?: string;
  durationType?: string;
  durationValue?: number;
  targetType?: string;
  targetValueLow?: number;
  targetValueHigh?: number;
  repeatValue?: number;
  steps?: ProviderWorkoutStep[];
};

export type ScheduledProgrammeSession = {
  id: string;
  scheduledStart: string;
  timezone: string;
  title: string;
  notes?: string;
  workout: {
    workoutName: string;
    description?: string;
    sport: string;
    steps: ProviderWorkoutStep[];
  };
};

type ProgrammePublisher = {
  cancelCalendarItem(
    calendarItemId: string,
    actor: { actorType: ActorType; actorId?: string; requestId?: string },
  ): Promise<unknown>;
  publishCalendarItem(
    calendarItemId: string,
    actor: { actorType: ActorType; actorId?: string; requestId?: string },
  ): Promise<{ eligible: boolean; deliveryState: string; reason?: string }>;
};

export type MasterProgrammeReconcileResult = {
  fingerprint: string;
  fromDate: string;
  throughDate?: string;
  canonicalSessions: number;
  staleItemsSuperseded: number;
  externalItemsCancelled: number;
  calendarItemsCreated: number;
  published: number;
  publishDeferred: number;
  publishFailures: string[];
  changed: boolean;
};

const scheduledWorkouts = scheduledWorkoutsJson as unknown as ScheduledProgrammeSession[];
const LONDON_TIME_ZONE = "Europe/London";

function dateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${mapped.year}-${mapped.month}-${mapped.day}`;
}

function timeParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${mapped.hour}:${mapped.minute}`;
}

export function londonDateKey(value = new Date()): string {
  return dateParts(value);
}

function sessionLocalDate(session: ScheduledProgrammeSession): string {
  return dateParts(new Date(session.scheduledStart));
}

function sessionLocalTime(session: ScheduledProgrammeSession): string {
  return timeParts(new Date(session.scheduledStart));
}

function dayOffset(fromDate: string, targetDate: string): number {
  const from = Date.parse(`${fromDate}T12:00:00.000Z`);
  const target = Date.parse(`${targetDate}T12:00:00.000Z`);
  return Math.round((target - from) / 86_400_000);
}

function phaseForIntensity(value?: string): WorkoutStepPhase {
  switch ((value ?? "").toUpperCase()) {
    case "WARMUP": return "warmup";
    case "RECOVERY":
    case "REST": return "recovery";
    case "COOLDOWN": return "cooldown";
    default: return "active";
  }
}

function sportForProvider(value: string): Sport {
  switch (value.toUpperCase()) {
    case "RUNNING": return "running";
    case "CYCLING": return "cycling";
    case "WALKING": return "walking";
    default: return "other";
  }
}

function durationForProvider(step: ProviderWorkoutStep): Pick<WorkoutExecutionStep, "durationType" | "durationValue" | "durationUnit" | "manualLapIntent"> {
  switch ((step.durationType ?? "").toUpperCase()) {
    case "TIME":
      return { durationType: "time", durationValue: step.durationValue, durationUnit: "seconds" };
    case "DISTANCE":
      return { durationType: "distance", durationValue: step.durationValue, durationUnit: "meters" };
    case "OPEN":
      return { durationType: "open", manualLapIntent: true };
    default:
      throw new Error(`Unsupported master-programme duration type: ${step.durationType ?? "missing"}`);
  }
}

function targetForProvider(step: ProviderWorkoutStep): Pick<WorkoutExecutionStep, "targetType" | "targetLow" | "targetHigh" | "targetUnit"> {
  switch ((step.targetType ?? "OPEN").toUpperCase()) {
    case "HEART_RATE":
      return {
        targetType: "heart_rate",
        targetLow: step.targetValueLow,
        targetHigh: step.targetValueHigh,
        targetUnit: "bpm",
      };
    case "SPEED": { // Tredict stores speed in metres/second; Paul's Running stores running targets as sec/km.
      const speeds = [step.targetValueLow, step.targetValueHigh]
        .filter((value): value is number => typeof value === "number" && value > 0);
      if (speeds.length === 0) return { targetType: "none" };
      const paces = speeds.map((speed) => 1000 / speed);
      return {
        targetType: "pace",
        targetLow: Math.min(...paces),
        targetHigh: Math.max(...paces),
        targetUnit: "sec_per_km",
      };
    }
    case "OPEN":
    default:
      return { targetType: "none" };
  }
}

function convertProviderStep(step: ProviderWorkoutStep, sessionId: string, path: string, fallbackSequence: number): WorkoutStep {
  const sequence = Number.isInteger(step.stepOrder) ? Number(step.stepOrder) : fallbackSequence;
  if (step.type === "WorkoutRepeatStep") {
    const children = step.steps ?? [];
    return {
      id: `master-${sessionId}-${path}`,
      kind: "repeat",
      sequence,
      repeatCount: step.repeatValue ?? 1,
      instruction: step.description,
      children: children.map((child, index) => convertProviderStep(child, sessionId, `${path}-${index}`, index)),
    };
  }
  return {
    id: `master-${sessionId}-${path}`,
    kind: "step",
    sequence,
    phase: phaseForIntensity(step.intensity),
    ...durationForProvider(step),
    ...targetForProvider(step),
    instruction: step.description,
  };
}

export function convertScheduledWorkoutSteps(session: ScheduledProgrammeSession): WorkoutStep[] {
  return session.workout.steps.map((step, index) => convertProviderStep(step, session.id, String(index), index));
}

function programmeFingerprint(programme: ScheduledProgrammeSession[]): string {
  return createHash("sha256").update(JSON.stringify(programme)).digest("hex").slice(0, 16);
}

function derivedActor(actor: TrainingApiActor, key: string): TrainingApiActor {
  return {
    ...actor,
    idempotencyKey: key,
  };
}

function publisherActor(actor: TrainingApiActor) {
  return {
    actorType: actor.type,
    actorId: actor.id,
    requestId: actor.requestId,
  };
}

export async function reconcileMasterProgramme(options: {
  service: TrainingApiService;
  athleteId: string;
  actor: TrainingApiActor;
  fromDate?: string;
  publisher?: ProgrammePublisher;
  programme?: ScheduledProgrammeSession[];
}): Promise<MasterProgrammeReconcileResult> {
  const programme = options.programme ?? scheduledWorkouts;
  const fingerprint = programmeFingerprint(programme);
  const requestedFrom = options.fromDate ?? londonDateKey();
  const canonical = programme
    .map((session) => ({ session, localDate: sessionLocalDate(session), localTime: sessionLocalTime(session) }))
    .filter(({ localDate }) => localDate >= requestedFrom)
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.localTime.localeCompare(b.localTime));

  if (canonical.length === 0) {
    return {
      fingerprint,
      fromDate: requestedFrom,
      canonicalSessions: 0,
      staleItemsSuperseded: 0,
      externalItemsCancelled: 0,
      calendarItemsCreated: 0,
      published: 0,
      publishDeferred: 0,
      publishFailures: [],
      changed: false,
    };
  }

  const startDate = canonical[0].localDate;
  const throughDate = canonical[canonical.length - 1].localDate;
  const canonicalWorkouts = new Map<string, { id: string; version: number; session: ScheduledProgrammeSession; localDate: string; localTime: string }>();

  for (const entry of canonical) {
    const created = await options.service.createWorkout({
      athleteId: options.athleteId,
      name: entry.session.title,
      description: entry.session.notes ?? entry.session.workout.description,
      sport: sportForProvider(entry.session.workout.sport),
      steps: convertScheduledWorkoutSteps(entry.session),
    }, derivedActor(options.actor, `master-programme:${fingerprint}:workout:${entry.session.id}`));
    canonicalWorkouts.set(entry.session.id, {
      id: created.workout.id,
      version: created.workout.currentVersion,
      session: entry.session,
      localDate: entry.localDate,
      localTime: entry.localTime,
    });
  }

  const existing = await options.service.listCalendar(
    options.athleteId,
    `${startDate}T00:00:00.000Z`,
    `${throughDate}T23:59:59.999Z`,
  ) as CalendarItem[];

  const plannedExisting = existing.filter((item) => item.status === "planned");
  const canonicalByDate = new Map<string, Array<{ sourceId: string; id: string; version: number }>>();
  for (const [sourceId, workout] of canonicalWorkouts) {
    const list = canonicalByDate.get(workout.localDate) ?? [];
    list.push({ sourceId, id: workout.id, version: workout.version });
    canonicalByDate.set(workout.localDate, list);
  }

  const exactItemIds = new Set<string>();
  const stale: CalendarItem[] = [];
  for (const item of plannedExisting) {
    const itemDate = dateParts(new Date(item.scheduledStart));
    const allowed = canonicalByDate.get(itemDate) ?? [];
    const exact = allowed.find((candidate) => candidate.id === item.workout.id && candidate.version === item.workout.version);
    if (exact) exactItemIds.add(item.id);
    else stale.push(item);
  }

  let externalItemsCancelled = 0;
  for (const item of stale) {
    const sync = await options.service.getSyncStatus(item.id);
    if (sync.externalReference) {
      if (!options.publisher) {
        throw new Error(`Cannot safely replace calendar item ${item.id}: it has been published but no provider publisher is configured.`);
      }
      await options.publisher.cancelCalendarItem(item.id, publisherActor(options.actor));
      externalItemsCancelled += 1;
    }
    await options.service.supersedeCalendarItem(
      item.id,
      derivedActor(options.actor, `master-programme:${fingerprint}:supersede:${item.id}`),
    );
  }

  const missing = [...canonicalWorkouts.entries()].filter(([, workout]) => {
    return !plannedExisting.some((item) => {
      if (stale.some((staleItem) => staleItem.id === item.id)) return false;
      return item.workout.id === workout.id && item.workout.version === workout.version;
    });
  });

  let createdItems: CalendarItem[] = [];
  if (missing.length > 0) {
    const missingKey = createHash("sha256")
      .update(missing.map(([sourceId]) => sourceId).sort().join("|"))
      .digest("hex")
      .slice(0, 12);
    const plan = await options.service.createPlan({
      athleteId: options.athleteId,
      name: `Master programme reconciliation ${startDate}–${throughDate}`,
      description: `Canonical calendar projection of scheduled-workouts.json (${fingerprint}).`,
      items: missing.map(([sourceId, workout], sequence) => ({
        id: `master-programme-${sourceId}`,
        sequence,
        dayOffset: dayOffset(startDate, workout.localDate),
        localStartTime: workout.localTime,
        workoutId: workout.id,
        workoutVersion: workout.version,
      })),
    }, derivedActor(options.actor, `master-programme:${fingerprint}:plan:${missingKey}`));

    const applied = await options.service.applyPlan(plan.id, {
      planVersion: plan.currentVersion,
      startDate,
      timezone: LONDON_TIME_ZONE,
    }, derivedActor(options.actor, `master-programme:${fingerprint}:apply:${missingKey}`));
    createdItems = applied.calendarItems as CalendarItem[];
  }

  let published = 0;
  let publishDeferred = 0;
  const publishFailures: string[] = [];
  if (options.publisher) {
    for (const item of createdItems) {
      try {
        const result = await options.publisher.publishCalendarItem(item.id, publisherActor(options.actor));
        if (result.eligible && result.deliveryState === "sent") published += 1;
        else publishDeferred += 1;
      } catch (error) {
        publishFailures.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const changed = stale.length > 0 || createdItems.length > 0;
  return {
    fingerprint,
    fromDate: startDate,
    throughDate,
    canonicalSessions: canonical.length,
    staleItemsSuperseded: stale.length,
    externalItemsCancelled,
    calendarItemsCreated: createdItems.length,
    published,
    publishDeferred,
    publishFailures,
    changed,
  };
}
