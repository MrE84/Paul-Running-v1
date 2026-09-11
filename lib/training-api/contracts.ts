import type {
  Activity,
  Athlete,
  AuditEvent,
  CapacityRevision,
  CalendarItem,
  ExternalReference,
  SyncJob,
  TrainingPlan,
  TrainingPlanRevision,
  Workout,
  WorkoutRevision,
  ZoneSet,
} from "../domain/contracts";
import type { PlanApplication, ScheduledCalendarItem } from "../calendar/contracts";

export interface TrainingApiActor {
  type: "ai_client" | "user";
  id: string;
  requestId: string;
  idempotencyKey?: string;
}

export interface IdempotencyRecord {
  key: string;
  fingerprint: string;
  response: unknown;
  createdAt: string;
}

export interface TrainingApiSeed {
  athletes?: Athlete[];
  capacities?: CapacityRevision[];
  zoneSets?: ZoneSet[];
  workouts?: Workout[];
  workoutRevisions?: WorkoutRevision[];
  plans?: TrainingPlan[];
  planRevisions?: TrainingPlanRevision[];
  calendarItems?: ScheduledCalendarItem[];
  activities?: Activity[];
  applications?: PlanApplication[];
  auditEvents?: AuditEvent[];
}

export interface TrainingApiStore {
  getAthlete(id: string): Promise<Athlete | undefined>;
  listCapacities(athleteId: string): Promise<CapacityRevision[]>;
  listZoneSets(athleteId: string): Promise<ZoneSet[]>;

  listWorkouts(athleteId: string): Promise<Workout[]>;
  getWorkout(id: string): Promise<Workout | undefined>;
  getWorkoutRevision(id: string, version: number): Promise<WorkoutRevision | undefined>;
  saveWorkout(workout: Workout, revision: WorkoutRevision): Promise<void>;

  listPlans(athleteId: string): Promise<TrainingPlan[]>;
  getPlan(id: string): Promise<TrainingPlan | undefined>;
  getPlanRevision(id: string, version: number): Promise<TrainingPlanRevision | undefined>;
  savePlan(plan: TrainingPlan, revision: TrainingPlanRevision): Promise<void>;

  listCalendarItems(athleteId: string, from?: string, to?: string): Promise<ScheduledCalendarItem[]>;
  getCalendarItem(id: string): Promise<ScheduledCalendarItem | undefined>;
  savePlanApplication(application: PlanApplication, items: ScheduledCalendarItem[]): Promise<void>;

  listActivities(athleteId: string, limit?: number): Promise<Activity[]>;
  saveActivity(activity: Activity): Promise<void>;

  appendAuditEvent(event: AuditEvent): Promise<void>;
  listAuditEvents(): Promise<AuditEvent[]>;

  findIdempotency(key: string): Promise<IdempotencyRecord | undefined>;
  saveIdempotency(record: IdempotencyRecord): Promise<void>;
}

export interface TrainingApiRuntime {
  idFactory(): string;
  now(): string;
}

export interface ProfileView {
  athlete: Athlete;
  currentCapacity?: CapacityRevision;
  zoneSets: ZoneSet[];
}

export interface WorkoutMutationResult {
  workout: Workout;
  qa: {
    valid: boolean;
    findings: Array<{ severity: "error" | "warning"; code: string; path: string; message: string }>;
    errorCount: number;
    warningCount: number;
  };
}

export interface PlanApplicationView {
  application: PlanApplication;
  calendarItems: ScheduledCalendarItem[];
}

export interface SyncStatusView {
  calendarItem: CalendarItem;
  provider: string;
  state: "planned" | "queued" | "sent" | "failed";
  latestJob?: SyncJob;
  externalReference?: ExternalReference;
}
