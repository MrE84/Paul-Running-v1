export type UUID = string;
export type IsoDateTime = string;
export type LocalDate = string;
export type LocalTime = string;

export type Sport = "running" | "cycling" | "walking" | "other";
export type ActorType = "user" | "ai_client" | "connector" | "system";
export type CalendarItemStatus =
  | "planned"
  | "completed"
  | "skipped"
  | "canceled"
  | "superseded";

export type WorkoutDurationType = "time" | "distance" | "open";
export type WorkoutTargetType =
  | "none"
  | "heart_rate"
  | "pace"
  | "cadence"
  | "power";
export type WorkoutStepPhase = "warmup" | "active" | "recovery" | "cooldown";

export type SyncOperation = "publish" | "update" | "cancel" | "import";
export type SyncState =
  | "queued"
  | "running"
  | "succeeded"
  | "retryable_failure"
  | "permanent_failure";

export interface Athlete {
  id: UUID;
  displayName: string;
  timezone: string;
  heightCm?: number;
  weightKg?: number;
  dateOfBirth?: LocalDate;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CapacityRevision {
  id: UUID;
  athleteId: UUID;
  effectiveFrom: IsoDateTime;
  effectiveTo?: IsoDateTime;
  maxHrBpm?: number;
  restingHrBpm?: number;
  lt1HrBpm?: number;
  lt2HrBpm?: number;
  lt1PaceSecPerKm?: number;
  lt2PaceSecPerKm?: number;
  source: string;
  sourceNotes?: string;
  createdAt: IsoDateTime;
}

export interface Zone {
  id: UUID;
  zoneNumber: number;
  name: string;
  lowerBound?: number;
  upperBound?: number;
  unit: string;
}

export interface ZoneSet {
  id: UUID;
  athleteId: UUID;
  sport: Sport;
  targetType: WorkoutTargetType;
  name: string;
  effectiveFrom: IsoDateTime;
  effectiveTo?: IsoDateTime;
  source: string;
  zones: Zone[];
  createdAt: IsoDateTime;
}

export interface WorkoutExecutionStep {
  id: UUID;
  kind: "step";
  sequence: number;
  phase?: WorkoutStepPhase;
  name?: string;
  durationType: WorkoutDurationType;
  durationValue?: number;
  durationUnit?: string;
  targetType: WorkoutTargetType;
  targetLow?: number;
  targetHigh?: number;
  targetUnit?: string;
  instruction?: string;
}

export interface WorkoutRepeatStep {
  id: UUID;
  kind: "repeat";
  sequence: number;
  name?: string;
  repeatCount: number;
  children: WorkoutStep[];
  instruction?: string;
}

export type WorkoutStep = WorkoutExecutionStep | WorkoutRepeatStep;

export interface WorkoutRevision {
  workoutId: UUID;
  version: number;
  name: string;
  description?: string;
  sport: Sport;
  steps: WorkoutStep[];
  createdAt: IsoDateTime;
  createdByActor: ActorType;
}

export interface Workout {
  id: UUID;
  athleteId: UUID;
  currentVersion: number;
  archivedAt?: IsoDateTime;
  currentRevision: WorkoutRevision;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface TrainingPlanItem {
  id: UUID;
  sequence: number;
  dayOffset: number;
  localStartTime?: LocalTime;
  workoutId: UUID;
  workoutVersion: number;
}

export interface TrainingPlanRevision {
  planId: UUID;
  version: number;
  name: string;
  description?: string;
  items: TrainingPlanItem[];
  createdAt: IsoDateTime;
  createdByActor: ActorType;
}

export interface TrainingPlan {
  id: UUID;
  athleteId: UUID;
  currentVersion: number;
  archivedAt?: IsoDateTime;
  currentRevision: TrainingPlanRevision;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CalendarItemWorkoutRef {
  id: UUID;
  version: number;
}

export interface CalendarItemPlanRef {
  id: UUID;
  version: number;
  itemId?: UUID;
}

export interface CalendarItem {
  id: UUID;
  athleteId: UUID;
  workout: CalendarItemWorkoutRef;
  sourcePlan?: CalendarItemPlanRef;
  scheduledStart: IsoDateTime;
  timezone: string;
  status: CalendarItemStatus;
  supersedesCalendarItemId?: UUID;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ActivitySummary {
  durationSeconds?: number;
  distanceMeters?: number;
  avgHrBpm?: number;
  maxHrBpm?: number;
  avgPaceSecPerKm?: number;
  avgCadenceSpm?: number;
  elevationGainMeters?: number;
}

export interface Activity {
  id: UUID;
  athleteId: UUID;
  calendarItemId?: UUID;
  sport: Sport;
  startedAt: IsoDateTime;
  endedAt?: IsoDateTime;
  summary: ActivitySummary;
  normalizedData: Record<string, unknown>;
  sourceFileName?: string;
  sourceFileSha256?: string;
  sourceMetadata: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Equipment {
  id: UUID;
  athleteId: UUID;
  kind: string;
  brand?: string;
  model: string;
  nickname?: string;
  firstUsedAt?: LocalDate;
  retiredAt?: LocalDate;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ExternalReference {
  id: UUID;
  athleteId: UUID;
  entityType: string;
  entityId: UUID;
  provider: string;
  externalId: string;
  externalUrl?: string;
  providerMetadata: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface SyncJob {
  id: UUID;
  athleteId: UUID;
  provider: string;
  entityType: string;
  entityId: UUID;
  entityVersion?: number;
  operation: SyncOperation;
  state: SyncState;
  idempotencyKey: string;
  attemptCount: number;
  nextAttemptAt?: IsoDateTime;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt?: IsoDateTime;
}

export interface AuditEvent {
  id: UUID;
  athleteId?: UUID;
  actorType: ActorType;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: UUID;
  entityVersion?: number;
  requestId?: string;
  occurredAt: IsoDateTime;
}

export interface ApplyTrainingPlanCommand {
  athleteId: UUID;
  planId: UUID;
  planVersion: number;
  startDate: LocalDate;
  timezone: string;
}

export interface CreateWorkoutRevisionCommand {
  workoutId: UUID;
  expectedVersion: number;
  revision: Omit<
    WorkoutRevision,
    "workoutId" | "version" | "createdAt" | "createdByActor"
  >;
}

export interface RescheduleCalendarItemCommand {
  calendarItemId: UUID;
  expectedUpdatedAt: IsoDateTime;
  scheduledStart: IsoDateTime;
  timezone: string;
}

export interface CanonicalScheduledWorkout {
  athlete: Athlete;
  calendarItem: CalendarItem;
  workout: WorkoutRevision;
}

export type ConnectorFailureKind = "retryable" | "permanent";

export interface ConnectorSuccess {
  ok: true;
  externalId: string;
  externalUrl?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface ConnectorFailure {
  ok: false;
  kind: ConnectorFailureKind;
  code: string;
  message: string;
  providerMetadata?: Record<string, unknown>;
}

export type ConnectorResult = ConnectorSuccess | ConnectorFailure;

export interface TrainingSyncConnector {
  readonly provider: string;

  publish(input: CanonicalScheduledWorkout): Promise<ConnectorResult>;
  update(
    input: CanonicalScheduledWorkout,
    externalReference: ExternalReference,
  ): Promise<ConnectorResult>;
  cancel(
    item: CalendarItem,
    externalReference: ExternalReference,
  ): Promise<ConnectorResult>;
}

export interface ExternalActivityEnvelope {
  externalId: string;
  startedAt: IsoDateTime;
  sport: Sport;
  sourceFileUrl?: string;
  sourceMetadata: Record<string, unknown>;
}

export interface ActivityImportPage {
  items: ExternalActivityEnvelope[];
  nextCursor?: string;
}

export interface ActivityImportConnector {
  readonly provider: string;

  listCompleted(cursor?: string): Promise<ActivityImportPage>;
  fetchActivity(externalId: string): Promise<ExternalActivityEnvelope>;
}

export interface QaFinding {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface QaResult {
  valid: boolean;
  findings: QaFinding[];
}

export interface WorkoutQaService {
  validateWorkout(workout: WorkoutRevision): Promise<QaResult> | QaResult;
  validatePlanApplication(
    plan: TrainingPlanRevision,
    command: ApplyTrainingPlanCommand,
  ): Promise<QaResult> | QaResult;
}
