import type {
  WorkoutExecutionStep,
  WorkoutRevision,
  WorkoutStep,
} from "../domain/contracts";
import type { CalculatedRange, WorkoutSummary } from "./contracts";

interface NodeSummary {
  executionStepCount: number;
  repeatBlockCount: number;
  openStepCount: number;
  knownDurationSeconds: number;
  knownDistanceMeters: number;
  duration?: CalculatedRange;
  distance?: CalculatedRange;
}

function exact(value: number): CalculatedRange {
  return { min: value, max: value, exact: true };
}

function range(min: number, max: number): CalculatedRange {
  return { min, max, exact: Math.abs(max - min) < 1e-9 };
}

function addRanges(a: CalculatedRange, b: CalculatedRange): CalculatedRange {
  return range(a.min + b.min, a.max + b.max);
}

function multiplyRange(value: CalculatedRange, count: number): CalculatedRange {
  return range(value.min * count, value.max * count);
}

function paceRange(step: WorkoutExecutionStep): CalculatedRange | undefined {
  if (
    step.targetType !== "pace" ||
    step.targetUnit !== "sec_per_km" ||
    step.targetLow === undefined ||
    step.targetHigh === undefined ||
    step.targetLow <= 0 ||
    step.targetHigh <= 0
  ) {
    return undefined;
  }
  return range(step.targetLow, step.targetHigh);
}

function summarizeExecutionStep(step: WorkoutExecutionStep): NodeSummary {
  if (step.durationType === "open") {
    return {
      executionStepCount: 1,
      repeatBlockCount: 0,
      openStepCount: 1,
      knownDurationSeconds: 0,
      knownDistanceMeters: 0,
    };
  }

  const pace = paceRange(step);

  if (
    step.durationType === "time" &&
    step.durationUnit === "seconds" &&
    step.durationValue !== undefined
  ) {
    const duration = exact(step.durationValue);
    const distance = pace
      ? range(
          (step.durationValue / pace.max) * 1000,
          (step.durationValue / pace.min) * 1000,
        )
      : undefined;
    return {
      executionStepCount: 1,
      repeatBlockCount: 0,
      openStepCount: 0,
      knownDurationSeconds: step.durationValue,
      knownDistanceMeters: distance?.exact ? distance.min : 0,
      duration,
      distance,
    };
  }

  if (
    step.durationType === "distance" &&
    step.durationUnit === "meters" &&
    step.durationValue !== undefined
  ) {
    const distance = exact(step.durationValue);
    const duration = pace
      ? range(
          (step.durationValue / 1000) * pace.min,
          (step.durationValue / 1000) * pace.max,
        )
      : undefined;
    return {
      executionStepCount: 1,
      repeatBlockCount: 0,
      openStepCount: 0,
      knownDurationSeconds: duration?.exact ? duration.min : 0,
      knownDistanceMeters: step.durationValue,
      duration,
      distance,
    };
  }

  return {
    executionStepCount: 1,
    repeatBlockCount: 0,
    openStepCount: 0,
    knownDurationSeconds: 0,
    knownDistanceMeters: 0,
  };
}

function summarizeNodes(steps: WorkoutStep[]): NodeSummary {
  let result: NodeSummary = {
    executionStepCount: 0,
    repeatBlockCount: 0,
    openStepCount: 0,
    knownDurationSeconds: 0,
    knownDistanceMeters: 0,
    duration: exact(0),
    distance: exact(0),
  };

  for (const step of steps) {
    let current: NodeSummary;
    if (step.kind === "step") {
      current = summarizeExecutionStep(step);
    } else {
      const child = summarizeNodes(step.children);
      current = {
        executionStepCount: child.executionStepCount * step.repeatCount,
        repeatBlockCount: 1 + child.repeatBlockCount * step.repeatCount,
        openStepCount: child.openStepCount * step.repeatCount,
        knownDurationSeconds: child.knownDurationSeconds * step.repeatCount,
        knownDistanceMeters: child.knownDistanceMeters * step.repeatCount,
        duration: child.duration
          ? multiplyRange(child.duration, step.repeatCount)
          : undefined,
        distance: child.distance
          ? multiplyRange(child.distance, step.repeatCount)
          : undefined,
      };
    }

    result = {
      executionStepCount: result.executionStepCount + current.executionStepCount,
      repeatBlockCount: result.repeatBlockCount + current.repeatBlockCount,
      openStepCount: result.openStepCount + current.openStepCount,
      knownDurationSeconds: result.knownDurationSeconds + current.knownDurationSeconds,
      knownDistanceMeters: result.knownDistanceMeters + current.knownDistanceMeters,
      duration:
        result.duration && current.duration
          ? addRanges(result.duration, current.duration)
          : undefined,
      distance:
        result.distance && current.distance
          ? addRanges(result.distance, current.distance)
          : undefined,
    };
  }

  return result;
}

export function summarizeWorkout(workout: WorkoutRevision): WorkoutSummary {
  const summary = summarizeNodes(workout.steps);
  return {
    executionStepCount: summary.executionStepCount,
    repeatBlockCount: summary.repeatBlockCount,
    openStepCount: summary.openStepCount,
    knownDurationSeconds: summary.knownDurationSeconds,
    knownDistanceMeters: summary.knownDistanceMeters,
    totalDurationSeconds: summary.duration,
    totalDistanceMeters: summary.distance,
  };
}
