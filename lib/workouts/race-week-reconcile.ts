import type { RaceWeekWorkoutDefinition } from "./race-week";

export interface RaceWeekCalendarCandidate {
  id: string;
  scheduledLocalDate: string;
  scheduledLocalTime: string;
  status: string;
  createdAt?: string;
  workout: { id: string };
}

export interface RaceWeekWorkoutCandidate {
  id: string;
  currentRevision: { name: string };
}

export interface RaceWeekReconciliation {
  keepers: Partial<Record<RaceWeekWorkoutDefinition["key"], RaceWeekCalendarCandidate>>;
  duplicates: RaceWeekCalendarCandidate[];
  missing: RaceWeekWorkoutDefinition[];
}

export function raceWeekLocalDate(startDate: string, dayOffset: number): string {
  const parsed = new Date(`${startDate}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid race-week start date ${startDate}.`);
  parsed.setUTCDate(parsed.getUTCDate() + dayOffset);
  return parsed.toISOString().slice(0, 10);
}

export function classifyRaceWeekCalendar(
  definitions: readonly RaceWeekWorkoutDefinition[],
  startDate: string,
  calendarItems: readonly RaceWeekCalendarCandidate[],
  workouts: readonly RaceWeekWorkoutCandidate[],
): RaceWeekReconciliation {
  const workoutNames = new Map(workouts.map((workout) => [workout.id, workout.currentRevision.name]));
  const keepers: RaceWeekReconciliation["keepers"] = {};
  const duplicates: RaceWeekCalendarCandidate[] = [];
  const missing: RaceWeekWorkoutDefinition[] = [];

  for (const definition of definitions) {
    const localDate = raceWeekLocalDate(startDate, definition.dayOffset);
    const matches = calendarItems
      .filter(
        (item) =>
          item.status === "planned" &&
          item.scheduledLocalDate === localDate &&
          item.scheduledLocalTime.slice(0, 5) === definition.localStartTime.slice(0, 5) &&
          workoutNames.get(item.workout.id) === definition.name,
      )
      .sort((left, right) => {
        const created = (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
        return created !== 0 ? created : left.id.localeCompare(right.id);
      });

    if (matches.length === 0) {
      missing.push(definition);
      continue;
    }

    keepers[definition.key] = matches[0];
    duplicates.push(...matches.slice(1));
  }

  return { keepers, duplicates, missing };
}
