import type {
  ActorType,
  IsoDateTime,
  Sport,
  UUID,
  WorkoutRevision,
  WorkoutStep,
} from "../domain/contracts";

export type WorkoutPhase = "warmup" | "active" | "recovery" | "cooldown";

export type WorkoutDurationInput =
  | { type: "time"; seconds: number }
  | { type: "distance"; meters: number }
  | { type: "open" };

export type WorkoutTargetInput =
  | { type: "none" }
  | { type: "pace"; lowSecPerKm: number; highSecPerKm?: number }
  | { type: "heart_rate"; lowBpm: number; highBpm?: number }
  | { type: "cadence"; lowSpm: number; highSpm?: number }
  | { type: "power"; lowWatts: number; highWatts?: number };

export interface WorkoutBuilderStep {
  kind: "step";
  phase: WorkoutPhase;
  name?: string;
  duration: WorkoutDurationInput;
  target?: WorkoutTargetInput;
  instruction?: string;
}

export interface WorkoutBuilderRepeat {
  kind: "repeat";
  name?: string;
  repeatCount: number;
  children: WorkoutBuilderNode[];
  instruction?: string;
}

export type WorkoutBuilderNode = WorkoutBuilderStep | WorkoutBuilderRepeat;

export interface BuildWorkoutInput {
  workoutId: UUID;
  version: number;
  name: string;
  description?: string;
  sport?: Sport;
  steps: WorkoutBuilderNode[];
  createdAt: IsoDateTime;
  createdByActor: ActorType;
}

export interface WorkoutBuilderContext {
  idFactory: () => UUID;
}

export interface CalculatedRange {
  min: number;
  max: number;
  exact: boolean;
}

export interface WorkoutSummary {
  executionStepCount: number;
  repeatBlockCount: number;
  openStepCount: number;
  knownDurationSeconds: number;
  knownDistanceMeters: number;
  totalDurationSeconds?: CalculatedRange;
  totalDistanceMeters?: CalculatedRange;
}

export interface BuiltWorkout {
  workout: WorkoutRevision;
  summary: WorkoutSummary;
}

export interface WorkoutPreset {
  name: string;
  steps: WorkoutBuilderNode[];
}

export type CanonicalWorkoutStep = WorkoutStep;
