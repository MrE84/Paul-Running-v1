import type {
  CapacityRevision,
  QaFinding,
  QaResult,
  WorkoutDurationType,
  WorkoutRevision,
  WorkoutTargetType,
  ZoneSet,
} from "../domain/contracts";
import type { ScheduledCalendarItem } from "../calendar/contracts";

export interface DeliveryProfile {
  id: string;
  provider: string;
  supportedDurationTypes: readonly WorkoutDurationType[];
  supportedTargetTypes: readonly WorkoutTargetType[];
  maxRepeatDepth: number;
  maxExpandedExecutionSteps: number;
  requireExplicitManualLapIntent: boolean;
}

export interface SyncStepProjection {
  /**
   * Duration emitted by a connector for a distance+pace step. QA compares this
   * with the mathematically derived duration range to catch translation errors.
   */
  durationSeconds?: number;
  distanceMeters?: number;
}

export interface SyncProjection {
  provider: string;
  steps: Readonly<Record<string, SyncStepProjection>>;
}

export interface WorkoutQaContext {
  zoneSets?: readonly ZoneSet[];
  capacity?: CapacityRevision;
  calendarItem?: ScheduledCalendarItem;
  deliveryProfile?: DeliveryProfile;
  syncProjection?: SyncProjection;
  maxSensibleDurationSeconds?: number;
  maxSensibleDistanceMeters?: number;
}

export interface WorkoutQaReport extends QaResult {
  findings: QaFinding[];
  errorCount: number;
  warningCount: number;
}

export interface WorkoutSyncCandidate {
  workout: WorkoutRevision;
  context: WorkoutQaContext;
}

export interface PaceArithmetic {
  minDurationSeconds: number;
  maxDurationSeconds: number;
}
