import type { Sport, WorkoutStep } from "../domain/contracts";

export interface PostHalfRecoveryWorkoutDefinition {
  key: "monday-walk" | "wednesday-run-walk" | "friday-easy" | "sunday-aerobic";
  name: string;
  description: string;
  sport: Sport;
  dayOffset: number;
  localStartTime: string;
  steps: WorkoutStep[];
}

function timeNone(
  id: string,
  sequence: number,
  seconds: number,
  instruction: string,
  phase: "warmup" | "active" | "recovery" | "cooldown" = "active",
): WorkoutStep {
  return {
    id,
    kind: "step",
    sequence,
    phase,
    durationType: "time",
    durationValue: seconds,
    durationUnit: "seconds",
    targetType: "none",
    instruction,
  };
}

export const POST_HALF_RECOVERY_START_DATE = "2026-09-21";

export const POST_HALF_RECOVERY_2026: PostHalfRecoveryWorkoutDefinition[] = [
  {
    key: "monday-walk",
    name: "Post-Half Recovery Walk",
    description:
      "Monday 21 Sep. Thirty minutes of easy walking for circulation only. No pace target. Keep the stride natural and stop if race soreness changes your gait or becomes sharp/localised pain.",
    sport: "walking",
    dayOffset: 0,
    localStartTime: "18:00",
    steps: [
      timeNone("recovery-walk", 0, 1800, "Easy recovery walk; relaxed circulation only"),
    ],
  },
  {
    key: "wednesday-run-walk",
    name: "Post-Half Recovery Run-Walk",
    description:
      "Wednesday 23 Sep. First running check after the half marathon. Five minutes walking, fifteen minutes very easy running, five minutes walking. No pace target. Keep the running comfortably below measured LT1 (~144 bpm) if practical. If soreness is more than mild or alters gait, walk instead or skip.",
    sport: "running",
    dayOffset: 2,
    localStartTime: "18:00",
    steps: [
      timeNone("recovery-run-walk-warmup", 0, 300, "Walk; assess legs before running", "warmup"),
      timeNone("recovery-run-walk-easy", 1, 900, "Very easy run; stay below LT1 ~144 bpm; no pace target", "active"),
      timeNone("recovery-run-walk-cooldown", 2, 300, "Walk easy to finish", "cooldown"),
    ],
  },
  {
    key: "friday-easy",
    name: "Post-Half Easy Run",
    description:
      "Friday 25 Sep. Thirty minutes total. Five minutes very easy, twenty minutes easy aerobic, five minutes easy finish. Keep the whole session conversational and below measured LT1 (~144 bpm) if practical. No strides, hills or pace chasing.",
    sport: "running",
    dayOffset: 4,
    localStartTime: "18:00",
    steps: [
      timeNone("recovery-friday-warmup", 0, 300, "Very easy start", "warmup"),
      timeNone("recovery-friday-main", 1, 1200, "Easy aerobic; below LT1 ~144 bpm; no pace target", "active"),
      timeNone("recovery-friday-cooldown", 2, 300, "Easy finish; stay relaxed", "cooldown"),
    ],
  },
  {
    key: "sunday-aerobic",
    name: "Post-Half Easy Aerobic Run",
    description:
      "Sunday 27 Sep. Forty-five minutes total. This is still recovery week, not a return to normal training. Keep the session easy and conversational, below measured LT1 (~144 bpm) if practical. No fast finish. Shorten or skip if race soreness has not resolved.",
    sport: "running",
    dayOffset: 6,
    localStartTime: "09:00",
    steps: [
      timeNone("recovery-sunday-warmup", 0, 300, "Very easy opening", "warmup"),
      timeNone("recovery-sunday-main", 1, 2100, "Easy aerobic; below LT1 ~144 bpm; no pace target", "active"),
      timeNone("recovery-sunday-cooldown", 2, 300, "Easy finish; no fast finish", "cooldown"),
    ],
  },
];
