import type { TrainingPlanItem, WorkoutRevision } from "../domain/contracts";
import type {
  ApplyPlanContext,
  ApplyPlanInput,
  ApplyPlanResult,
  ScheduledCalendarItem,
} from "./contracts";
import {
  addLocalDays,
  localDateTimeToUtc,
  parseLocalDate,
  parseLocalTime,
} from "./timezone";

export function workoutRevisionKey(workoutId: string, version: number): string {
  return `${workoutId}@${version}`;
}

function requireWorkout(
  workouts: ReadonlyMap<string, WorkoutRevision>,
  item: TrainingPlanItem,
): WorkoutRevision {
  const workout = workouts.get(workoutRevisionKey(item.workoutId, item.workoutVersion));
  if (!workout) {
    throw new Error(
      `Plan item ${item.id} references missing workout ${item.workoutId} v${item.workoutVersion}.`,
    );
  }
  if (
    workout.workoutId !== item.workoutId ||
    workout.version !== item.workoutVersion
  ) {
    throw new Error(`Workout lookup returned inconsistent revision for plan item ${item.id}.`);
  }
  return workout;
}

function validatePlanItems(input: ApplyPlanInput): void {
  parseLocalDate(input.startDate);
  if (input.defaultLocalStartTime) {
    parseLocalTime(input.defaultLocalStartTime);
  }

  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const item of input.plan.items) {
    if (ids.has(item.id)) {
      throw new Error(`Duplicate plan item id: ${item.id}`);
    }
    ids.add(item.id);

    if (!Number.isInteger(item.sequence) || item.sequence < 0) {
      throw new Error(`Plan item ${item.id} has invalid sequence ${item.sequence}.`);
    }
    if (sequences.has(item.sequence)) {
      throw new Error(`Duplicate plan item sequence: ${item.sequence}`);
    }
    sequences.add(item.sequence);

    if (!Number.isInteger(item.dayOffset) || item.dayOffset < 0) {
      throw new Error(`Plan item ${item.id} has invalid day offset ${item.dayOffset}.`);
    }
    if (item.localStartTime) {
      parseLocalTime(item.localStartTime);
    }
    requireWorkout(input.workouts, item);
  }
}

export function applyTrainingPlan(
  input: ApplyPlanInput,
  context: ApplyPlanContext,
): ApplyPlanResult {
  validatePlanItems(input);

  const appliedAt = context.now();
  const applicationId = context.idFactory();
  const application = {
    id: applicationId,
    athleteId: input.athleteId,
    planId: input.plan.planId,
    planVersion: input.plan.version,
    startDate: input.startDate,
    timezone: input.timezone,
    appliedAt,
    appliedByActor: context.actor,
  } as const;

  const calendarItems: ScheduledCalendarItem[] = [...input.plan.items]
    .sort((a, b) => a.sequence - b.sequence)
    .map((item) => {
      const scheduledLocalDate = addLocalDays(input.startDate, item.dayOffset);
      const scheduledLocalTime = item.localStartTime ?? input.defaultLocalStartTime;
      if (!scheduledLocalTime) {
        throw new Error(
          `Plan item ${item.id} has no local start time and no default was provided.`,
        );
      }

      const scheduledStart = localDateTimeToUtc(
        scheduledLocalDate,
        scheduledLocalTime,
        input.timezone,
        input.localTimeDisambiguation ?? "reject",
      );

      return {
        id: context.idFactory(),
        athleteId: input.athleteId,
        workout: {
          id: item.workoutId,
          version: item.workoutVersion,
        },
        sourcePlan: {
          id: input.plan.planId,
          version: input.plan.version,
          itemId: item.id,
        },
        planApplicationId: applicationId,
        scheduledLocalDate,
        scheduledLocalTime,
        scheduledStart,
        timezone: input.timezone,
        status: "planned",
        createdAt: appliedAt,
        updatedAt: appliedAt,
      };
    });

  return { application, calendarItems };
}
