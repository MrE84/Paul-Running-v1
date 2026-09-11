import type {
  WorkoutExecutionStep,
  WorkoutRepeatStep,
  WorkoutRevision,
  WorkoutStep,
} from "../domain/contracts";
import type {
  BuildWorkoutInput,
  BuiltWorkout,
  WorkoutBuilderContext,
  WorkoutBuilderNode,
  WorkoutBuilderRepeat,
  WorkoutBuilderStep,
  WorkoutDurationInput,
  WorkoutPhase,
  WorkoutTargetInput,
} from "./contracts";
import { summarizeWorkout } from "./summary";

export const noTarget = (): WorkoutTargetInput => ({ type: "none" });

export const paceTarget = (
  lowSecPerKm: number,
  highSecPerKm: number = lowSecPerKm,
): WorkoutTargetInput => ({ type: "pace", lowSecPerKm, highSecPerKm });

export const heartRateTarget = (
  lowBpm: number,
  highBpm: number = lowBpm,
): WorkoutTargetInput => ({ type: "heart_rate", lowBpm, highBpm });

export const cadenceTarget = (
  lowSpm: number,
  highSpm: number = lowSpm,
): WorkoutTargetInput => ({ type: "cadence", lowSpm, highSpm });

export const powerTarget = (
  lowWatts: number,
  highWatts: number = lowWatts,
): WorkoutTargetInput => ({ type: "power", lowWatts, highWatts });

export const timeDuration = (seconds: number): WorkoutDurationInput => ({
  type: "time",
  seconds,
});

export const distanceDuration = (meters: number): WorkoutDurationInput => ({
  type: "distance",
  meters,
});

export const manualLapDuration = (): WorkoutDurationInput => ({ type: "open" });

export function step(
  phase: WorkoutPhase,
  duration: WorkoutDurationInput,
  target: WorkoutTargetInput = noTarget(),
  options: Pick<WorkoutBuilderStep, "name" | "instruction"> = {},
): WorkoutBuilderStep {
  return {
    kind: "step",
    phase,
    duration,
    target,
    ...options,
  };
}

export function repeat(
  repeatCount: number,
  children: WorkoutBuilderNode[],
  options: Pick<WorkoutBuilderRepeat, "name" | "instruction"> = {},
): WorkoutBuilderRepeat {
  return {
    kind: "repeat",
    repeatCount,
    children,
    ...options,
  };
}

function requireFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number greater than zero.`);
  }
}

function validateTarget(target: WorkoutTargetInput): void {
  if (target.type === "none") return;

  let low: number;
  let high: number;
  switch (target.type) {
    case "pace":
      low = target.lowSecPerKm;
      high = target.highSecPerKm ?? low;
      break;
    case "heart_rate":
      low = target.lowBpm;
      high = target.highBpm ?? low;
      break;
    case "cadence":
      low = target.lowSpm;
      high = target.highSpm ?? low;
      break;
    case "power":
      low = target.lowWatts;
      high = target.highWatts ?? low;
      break;
  }

  requireFinitePositive(low, `${target.type} target lower bound`);
  requireFinitePositive(high, `${target.type} target upper bound`);
  if (high < low) {
    throw new Error(`${target.type} target upper bound cannot be lower than its lower bound.`);
  }
}

function validateNode(node: WorkoutBuilderNode, path: string): void {
  if (node.kind === "repeat") {
    if (!Number.isInteger(node.repeatCount) || node.repeatCount < 1) {
      throw new Error(`${path}.repeatCount must be a positive integer.`);
    }
    if (node.children.length === 0) {
      throw new Error(`${path} repeat block must contain at least one child step.`);
    }
    node.children.forEach((child, index) => validateNode(child, `${path}.children[${index}]`));
    return;
  }

  switch (node.duration.type) {
    case "time":
      requireFinitePositive(node.duration.seconds, `${path}.duration.seconds`);
      break;
    case "distance":
      requireFinitePositive(node.duration.meters, `${path}.duration.meters`);
      break;
    case "open":
      break;
  }
  validateTarget(node.target ?? noTarget());
}

function canonicalTarget(target: WorkoutTargetInput): Pick<
  WorkoutExecutionStep,
  "targetType" | "targetLow" | "targetHigh" | "targetUnit"
> {
  switch (target.type) {
    case "none":
      return { targetType: "none" };
    case "pace":
      return {
        targetType: "pace",
        targetLow: target.lowSecPerKm,
        targetHigh: target.highSecPerKm ?? target.lowSecPerKm,
        targetUnit: "sec_per_km",
      };
    case "heart_rate":
      return {
        targetType: "heart_rate",
        targetLow: target.lowBpm,
        targetHigh: target.highBpm ?? target.lowBpm,
        targetUnit: "bpm",
      };
    case "cadence":
      return {
        targetType: "cadence",
        targetLow: target.lowSpm,
        targetHigh: target.highSpm ?? target.lowSpm,
        targetUnit: "spm",
      };
    case "power":
      return {
        targetType: "power",
        targetLow: target.lowWatts,
        targetHigh: target.highWatts ?? target.lowWatts,
        targetUnit: "watts",
      };
  }
}

function canonicalDuration(duration: WorkoutDurationInput): Pick<
  WorkoutExecutionStep,
  "durationType" | "durationValue" | "durationUnit" | "manualLapIntent"
> {
  switch (duration.type) {
    case "time":
      return {
        durationType: "time",
        durationValue: duration.seconds,
        durationUnit: "seconds",
        manualLapIntent: false,
      };
    case "distance":
      return {
        durationType: "distance",
        durationValue: duration.meters,
        durationUnit: "meters",
        manualLapIntent: false,
      };
    case "open":
      return { durationType: "open", manualLapIntent: true };
  }
}

function buildNodes(
  nodes: WorkoutBuilderNode[],
  context: WorkoutBuilderContext,
): WorkoutStep[] {
  return nodes.map((node, sequence) => {
    if (node.kind === "repeat") {
      const repeatStep: WorkoutRepeatStep = {
        id: context.idFactory(),
        kind: "repeat",
        sequence,
        name: node.name,
        repeatCount: node.repeatCount,
        children: buildNodes(node.children, context),
        instruction: node.instruction,
      };
      return repeatStep;
    }

    const executionStep: WorkoutExecutionStep = {
      id: context.idFactory(),
      kind: "step",
      sequence,
      phase: node.phase,
      name: node.name,
      ...canonicalDuration(node.duration),
      ...canonicalTarget(node.target ?? noTarget()),
      instruction: node.instruction,
    };
    return executionStep;
  });
}

export function buildWorkout(
  input: BuildWorkoutInput,
  context: WorkoutBuilderContext,
): BuiltWorkout {
  if (!input.workoutId) throw new Error("workoutId is required.");
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error("Workout version must be a positive integer.");
  }
  if (!input.name.trim()) throw new Error("Workout name is required.");
  if (input.steps.length === 0) throw new Error("Workout must contain at least one step.");

  input.steps.forEach((node, index) => validateNode(node, `steps[${index}]`));

  const workout: WorkoutRevision = {
    workoutId: input.workoutId,
    version: input.version,
    name: input.name.trim(),
    description: input.description,
    sport: input.sport ?? "running",
    steps: buildNodes(input.steps, context),
    createdAt: input.createdAt,
    createdByActor: input.createdByActor,
  };

  return {
    workout,
    summary: summarizeWorkout(workout),
  };
}
