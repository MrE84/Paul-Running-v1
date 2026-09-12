import type {
  Activity,
  Athlete,
  AuditEvent,
  CapacityRevision,
  TrainingPlan,
  TrainingPlanRevision,
  Workout,
  WorkoutRevision,
  ZoneSet,
} from "../domain/contracts";
import type { PlanApplication, ScheduledCalendarItem } from "../calendar/contracts";
import type { IdempotencyRecord, TrainingApiSeed, TrainingApiStore } from "./contracts";

const revisionKey = (id: string, version: number) => `${id}@${version}`;

/** Reference store for tests/local development. Production persistence can
 * implement the same port against PostgreSQL. */
export class InMemoryTrainingApiStore implements TrainingApiStore {
  private readonly athletes = new Map<string, Athlete>();
  private readonly capacities: CapacityRevision[] = [];
  private readonly zones: ZoneSet[] = [];
  private readonly workouts = new Map<string, Workout>();
  private readonly workoutRevisions = new Map<string, WorkoutRevision>();
  private readonly plans = new Map<string, TrainingPlan>();
  private readonly planRevisions = new Map<string, TrainingPlanRevision>();
  private readonly calendar = new Map<string, ScheduledCalendarItem>();
  private readonly activities = new Map<string, Activity>();
  private readonly applications = new Map<string, PlanApplication>();
  private readonly audits: AuditEvent[] = [];
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  constructor(seed: TrainingApiSeed = {}) {
    for (const athlete of seed.athletes ?? []) this.athletes.set(athlete.id, athlete);
    this.capacities.push(...(seed.capacities ?? []));
    this.zones.push(...(seed.zoneSets ?? []));
    for (const workout of seed.workouts ?? []) this.workouts.set(workout.id, workout);
    for (const revision of seed.workoutRevisions ?? []) this.workoutRevisions.set(revisionKey(revision.workoutId, revision.version), revision);
    for (const workout of seed.workouts ?? []) this.workoutRevisions.set(revisionKey(workout.id, workout.currentRevision.version), workout.currentRevision);
    for (const plan of seed.plans ?? []) this.plans.set(plan.id, plan);
    for (const revision of seed.planRevisions ?? []) this.planRevisions.set(revisionKey(revision.planId, revision.version), revision);
    for (const plan of seed.plans ?? []) this.planRevisions.set(revisionKey(plan.id, plan.currentRevision.version), plan.currentRevision);
    for (const item of seed.calendarItems ?? []) this.calendar.set(item.id, item);
    for (const activity of seed.activities ?? []) this.activities.set(activity.id, activity);
    for (const application of seed.applications ?? []) this.applications.set(application.id, application);
    this.audits.push(...(seed.auditEvents ?? []));
  }

  async withIdempotencyLock<T>(_key: string, operation: () => Promise<T>): Promise<T> { return operation(); }
  async getAthlete(id: string) { return this.athletes.get(id); }
  async listCapacities(athleteId: string) { return this.capacities.filter((item) => item.athleteId === athleteId).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)); }
  async listZoneSets(athleteId: string) { return this.zones.filter((item) => item.athleteId === athleteId).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)); }
  async listWorkouts(athleteId: string) { return [...this.workouts.values()].filter((item) => item.athleteId === athleteId).sort((a, b) => a.id.localeCompare(b.id)); }
  async getWorkout(id: string) { return this.workouts.get(id); }
  async getWorkoutRevision(id: string, version: number) { return this.workoutRevisions.get(revisionKey(id, version)); }
  async saveWorkout(workout: Workout, revision: WorkoutRevision) { this.workouts.set(workout.id, workout); this.workoutRevisions.set(revisionKey(workout.id, revision.version), revision); }
  async listPlans(athleteId: string) { return [...this.plans.values()].filter((item) => item.athleteId === athleteId).sort((a, b) => a.id.localeCompare(b.id)); }
  async getPlan(id: string) { return this.plans.get(id); }
  async getPlanRevision(id: string, version: number) { return this.planRevisions.get(revisionKey(id, version)); }
  async savePlan(plan: TrainingPlan, revision: TrainingPlanRevision) { this.plans.set(plan.id, plan); this.planRevisions.set(revisionKey(plan.id, revision.version), revision); }
  async listCalendarItems(athleteId: string, from?: string, to?: string) {
    return [...this.calendar.values()].filter((item) => item.athleteId === athleteId).filter((item) => !from || item.scheduledStart >= from).filter((item) => !to || item.scheduledStart <= to).sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  }
  async getCalendarItem(id: string) { return this.calendar.get(id); }
  async saveCalendarItem(item: ScheduledCalendarItem) { this.calendar.set(item.id, item); }
  async savePlanApplication(application: PlanApplication, items: ScheduledCalendarItem[]) { this.applications.set(application.id, application); for (const item of items) this.calendar.set(item.id, item); }
  async listActivities(athleteId: string, limit = 20) { return [...this.activities.values()].filter((item) => item.athleteId === athleteId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, Math.max(0, limit)); }
  async saveActivity(activity: Activity) { this.activities.set(activity.id, activity); }
  async appendAuditEvent(event: AuditEvent) { this.audits.push(event); }
  async listAuditEvents() { return [...this.audits]; }
  async findIdempotency(key: string) { return this.idempotency.get(key); }
  async saveIdempotency(record: IdempotencyRecord) { this.idempotency.set(record.key, record); }
}
