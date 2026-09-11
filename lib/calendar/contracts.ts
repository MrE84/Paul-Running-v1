import type {
  ActorType,
  Activity,
  CalendarItem,
  IsoDateTime,
  LocalDate,
  LocalTime,
  TrainingPlanRevision,
  UUID,
  WorkoutRevision,
} from "../domain/contracts";
import type { LocalTimeDisambiguation } from "./timezone";

export interface PlanApplication {
  id: UUID;
  athleteId: UUID;
  planId: UUID;
  planVersion: number;
  startDate: LocalDate;
  timezone: string;
  appliedAt: IsoDateTime;
  appliedByActor: ActorType;
}

export interface ScheduledCalendarItem extends CalendarItem {
  planApplicationId: UUID;
  scheduledLocalDate: LocalDate;
  scheduledLocalTime: LocalTime;
}

export interface ApplyPlanInput {
  athleteId: UUID;
  plan: TrainingPlanRevision;
  workouts: ReadonlyMap<string, WorkoutRevision>;
  startDate: LocalDate;
  timezone: string;
  defaultLocalStartTime?: LocalTime;
  localTimeDisambiguation?: LocalTimeDisambiguation;
}

export interface ApplyPlanContext {
  idFactory: () => UUID;
  now: () => IsoDateTime;
  actor: ActorType;
}

export interface ApplyPlanResult {
  application: PlanApplication;
  calendarItems: ScheduledCalendarItem[];
}

export type CalendarEntry =
  | {
      kind: "scheduled";
      startsAt: IsoDateTime;
      status: CalendarItem["status"];
      calendarItem: ScheduledCalendarItem;
      workout?: WorkoutRevision;
      activity?: Activity;
    }
  | {
      kind: "unplanned_completed";
      startsAt: IsoDateTime;
      status: "completed";
      activity: Activity;
    };
