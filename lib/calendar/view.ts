import type { Activity, WorkoutRevision } from "../domain/contracts";
import type { CalendarEntry, ScheduledCalendarItem } from "./contracts";
import { workoutRevisionKey } from "./apply-plan";

export interface BuildCalendarViewInput {
  calendarItems: readonly ScheduledCalendarItem[];
  activities: readonly Activity[];
  workouts?: ReadonlyMap<string, WorkoutRevision>;
}

export function buildCalendarView(input: BuildCalendarViewInput): CalendarEntry[] {
  const activityByCalendarItem = new Map<string, Activity>();
  const unplannedActivities: Activity[] = [];

  for (const activity of input.activities) {
    if (!activity.calendarItemId) {
      unplannedActivities.push(activity);
      continue;
    }

    const existing = activityByCalendarItem.get(activity.calendarItemId);
    if (!existing || existing.startedAt < activity.startedAt) {
      activityByCalendarItem.set(activity.calendarItemId, activity);
    }
  }

  const scheduled: CalendarEntry[] = input.calendarItems.map((calendarItem) => {
    const activity = activityByCalendarItem.get(calendarItem.id);
    const workout = input.workouts?.get(
      workoutRevisionKey(calendarItem.workout.id, calendarItem.workout.version),
    );

    return {
      kind: "scheduled",
      startsAt: activity?.startedAt ?? calendarItem.scheduledStart,
      status: activity ? "completed" : calendarItem.status,
      calendarItem,
      workout,
      activity,
    };
  });

  const knownCalendarIds = new Set(input.calendarItems.map((item) => item.id));
  for (const activity of input.activities) {
    if (activity.calendarItemId && !knownCalendarIds.has(activity.calendarItemId)) {
      unplannedActivities.push(activity);
    }
  }

  const unplanned: CalendarEntry[] = unplannedActivities.map((activity) => ({
    kind: "unplanned_completed",
    startsAt: activity.startedAt,
    status: "completed",
    activity,
  }));

  return [...scheduled, ...unplanned].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
}
