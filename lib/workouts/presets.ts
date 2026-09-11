import type { WorkoutBuilderNode, WorkoutPreset, WorkoutTargetInput } from "./contracts";
import {
  distanceDuration,
  heartRateTarget,
  noTarget,
  paceTarget,
  repeat,
  step,
  timeDuration,
} from "./builder";

function targetOrNone(target?: WorkoutTargetInput): WorkoutTargetInput {
  return target ?? noTarget();
}

export function easyRunPreset(input: {
  durationSeconds: number;
  target?: WorkoutTargetInput;
}): WorkoutPreset {
  return {
    name: "Easy Run",
    steps: [
      step("active", timeDuration(input.durationSeconds), targetOrNone(input.target), {
        name: "Easy running",
      }),
    ],
  };
}

export function longRunPreset(input: {
  durationSeconds: number;
  target?: WorkoutTargetInput;
}): WorkoutPreset {
  return {
    name: "Long Run",
    steps: [
      step("active", timeDuration(input.durationSeconds), targetOrNone(input.target), {
        name: "Long easy running",
      }),
    ],
  };
}

export function thresholdPreset(input: {
  warmupSeconds: number;
  repetitions: number;
  workSeconds: number;
  recoverySeconds: number;
  thresholdTarget: WorkoutTargetInput;
  cooldownSeconds: number;
}): WorkoutPreset {
  const children: WorkoutBuilderNode[] = [
    step("active", timeDuration(input.workSeconds), input.thresholdTarget, {
      name: "Threshold",
    }),
    step("recovery", timeDuration(input.recoverySeconds), noTarget(), {
      name: "Recovery",
    }),
  ];

  return {
    name: "Threshold Session",
    steps: [
      step("warmup", timeDuration(input.warmupSeconds), noTarget(), { name: "Warm-up" }),
      repeat(input.repetitions, children, { name: "Threshold repeats" }),
      step("cooldown", timeDuration(input.cooldownSeconds), noTarget(), { name: "Cool-down" }),
    ],
  };
}

export function intervalPreset(input: {
  warmupSeconds: number;
  repetitions: number;
  workMeters: number;
  workTarget: WorkoutTargetInput;
  recoveryMeters?: number;
  recoverySeconds?: number;
  recoveryTarget?: WorkoutTargetInput;
  cooldownSeconds: number;
}): WorkoutPreset {
  if (!input.recoveryMeters && !input.recoverySeconds) {
    throw new Error("Interval preset requires a recovery distance or recovery time.");
  }
  if (input.recoveryMeters && input.recoverySeconds) {
    throw new Error("Interval preset recovery must use distance or time, not both.");
  }

  const recoveryDuration = input.recoveryMeters
    ? distanceDuration(input.recoveryMeters)
    : timeDuration(input.recoverySeconds as number);

  return {
    name: "Interval Session",
    steps: [
      step("warmup", timeDuration(input.warmupSeconds), noTarget(), { name: "Warm-up" }),
      repeat(
        input.repetitions,
        [
          step("active", distanceDuration(input.workMeters), input.workTarget, {
            name: "Interval",
          }),
          step("recovery", recoveryDuration, targetOrNone(input.recoveryTarget), {
            name: "Recovery",
          }),
        ],
        { name: "Intervals" },
      ),
      step("cooldown", timeDuration(input.cooldownSeconds), noTarget(), { name: "Cool-down" }),
    ],
  };
}

export function stridesPreset(input: {
  warmupSeconds: number;
  repetitions: number;
  strideSeconds: number;
  recoverySeconds: number;
  cadenceSpm?: number;
  cooldownSeconds: number;
}): WorkoutPreset {
  const strideTarget = input.cadenceSpm
    ? heartRateIndependentCadence(input.cadenceSpm)
    : noTarget();

  return {
    name: "Easy + Strides",
    steps: [
      step("warmup", timeDuration(input.warmupSeconds), noTarget(), { name: "Easy running" }),
      repeat(
        input.repetitions,
        [
          step("active", timeDuration(input.strideSeconds), strideTarget, { name: "Stride" }),
          step("recovery", timeDuration(input.recoverySeconds), noTarget(), {
            name: "Full easy recovery",
          }),
        ],
        { name: "Strides" },
      ),
      step("cooldown", timeDuration(input.cooldownSeconds), noTarget(), { name: "Easy cool-down" }),
    ],
  };
}

function heartRateIndependentCadence(spm: number): WorkoutTargetInput {
  return { type: "cadence", lowSpm: spm, highSpm: spm };
}

export const commonTargets = {
  pace: paceTarget,
  heartRate: heartRateTarget,
};
