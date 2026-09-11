import type { WorkoutPreset } from "../workouts/contracts";
import {
  distanceDuration,
  heartRateTarget,
  manualLapDuration,
  noTarget,
  paceTarget,
  repeat,
  step,
  timeDuration,
} from "../workouts/builder";
import type { IntervalsIcuTranslationConfig } from "./intervals-icu/translation";

export type Fenix5ValidationCaseId =
  | "time_auto"
  | "distance_auto"
  | "repeat_block"
  | "warmup_cooldown"
  | "recovery"
  | "heart_rate_range"
  | "pace_range"
  | "manual_lap"
  | "edit_resync";

export type Fenix5VerificationStatus = "automated_pass" | "device_pending" | "watch_verified";

export interface Fenix5ValidationCase {
  id: Fenix5ValidationCaseId;
  title: string;
  purpose: string;
  templateId: string;
  automatedExpectation: string;
  garminConnectExpectation: string;
  watchExpectation: string;
  status: Fenix5VerificationStatus;
}

export interface Fenix5ValidationTemplate {
  id: string;
  name: string;
  preset: WorkoutPreset;
  translationConfig?: IntervalsIcuTranslationConfig;
  candidateForKnownGood: true;
}

export interface Fenix5ValidationTemplateConfig {
  lthrBpm: number;
  hrLowBpm: number;
  hrHighBpm: number;
  paceLowSecPerKm: number;
  paceHighSecPerKm: number;
  manualLapPlaceholderSeconds?: number;
}

export const FENIX5_VALIDATION_MATRIX: readonly Fenix5ValidationCase[] = [
  {
    id: "time_auto",
    title: "Time-based automatic step",
    purpose: "Prove a timed step advances without a Lap press.",
    templateId: "fenix5-time-auto",
    automatedExpectation: "Intervals text contains explicit time durations and no press-lap flag.",
    garminConnectExpectation: "Workout step is represented as a timed running step.",
    watchExpectation: "Step ends automatically when its timer expires.",
    status: "device_pending",
  },
  {
    id: "distance_auto",
    title: "Distance-based automatic step",
    purpose: "Prove a distance step advances when the prescribed distance is reached.",
    templateId: "fenix5-distance-auto",
    automatedExpectation: "Intervals text contains metric distance tokens and no press-lap flag.",
    garminConnectExpectation: "Workout step is represented as a distance-based running step.",
    watchExpectation: "Step ends automatically at the prescribed distance.",
    status: "device_pending",
  },
  {
    id: "repeat_block",
    title: "Repeat block",
    purpose: "Prove repeated work/recovery structure survives the delivery chain.",
    templateId: "fenix5-repeat-pace",
    automatedExpectation: "Intervals text contains one top-level repeat block with three repetitions.",
    garminConnectExpectation: "Three work/recovery repetitions are visible in the structured workout.",
    watchExpectation: "Watch executes three work/recovery cycles in order.",
    status: "device_pending",
  },
  {
    id: "warmup_cooldown",
    title: "Warm-up and cool-down",
    purpose: "Prove warm-up and cool-down phases retain their position and labels.",
    templateId: "fenix5-repeat-pace",
    automatedExpectation: "Warm-up is first and cool-down is last in translated workout text.",
    garminConnectExpectation: "Warm-up and cool-down appear around the repeat set.",
    watchExpectation: "Watch starts in warm-up and finishes in cool-down after repeats.",
    status: "device_pending",
  },
  {
    id: "recovery",
    title: "Recovery step",
    purpose: "Prove recovery steps remain distinct from active work.",
    templateId: "fenix5-repeat-pace",
    automatedExpectation: "Each work step is followed by an explicit recovery duration.",
    garminConnectExpectation: "Recovery steps are present between work repetitions.",
    watchExpectation: "Watch transitions from work to recovery automatically on each repetition.",
    status: "device_pending",
  },
  {
    id: "heart_rate_range",
    title: "Heart-rate target range",
    purpose: "Prove canonical BPM is converted through an explicit LTHR anchor rather than silently changed.",
    templateId: "fenix5-hr-range",
    automatedExpectation: "BPM range is translated to an explicit percentage-of-LTHR range.",
    garminConnectExpectation: "A heart-rate target range is attached to the active step.",
    watchExpectation: "Watch shows/alerts against the intended HR range without changing step duration semantics.",
    status: "device_pending",
  },
  {
    id: "pace_range",
    title: "Pace target range",
    purpose: "Prove an absolute min/max pace range survives translation and delivery.",
    templateId: "fenix5-repeat-pace",
    automatedExpectation: "Absolute sec/km bounds render as an explicit min/max pace range.",
    garminConnectExpectation: "A pace target range is attached to the work step.",
    watchExpectation: "Watch displays the pace range and out-of-range guidance during work steps.",
    status: "device_pending",
  },
  {
    id: "manual_lap",
    title: "Intentional manual-Lap/open step",
    purpose: "Prove open-ended steps are only emitted when manual Lap intent is explicit.",
    templateId: "fenix5-manual-lap",
    automatedExpectation: "Translated step includes the Intervals.icu press-lap flag plus a load-only placeholder duration.",
    garminConnectExpectation: "Step is represented as Lap-controlled rather than an ordinary automatic timer.",
    watchExpectation: "Step continues until Lap is pressed, then advances immediately.",
    status: "device_pending",
  },
  {
    id: "edit_resync",
    title: "Edit and resync",
    purpose: "Prove an edited canonical workout updates the same external calendar event rather than duplicating it.",
    templateId: "fenix5-time-auto",
    automatedExpectation: "Stable external_id is preserved while changed source content produces an update payload.",
    garminConnectExpectation: "Existing scheduled workout is updated rather than duplicated.",
    watchExpectation: "After Garmin sync, only the current revision is offered for the scheduled session.",
    status: "device_pending",
  },
] as const;

function requireFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number greater than zero.`);
  }
}

export function createFenix5ValidationTemplates(
  config: Fenix5ValidationTemplateConfig,
): readonly Fenix5ValidationTemplate[] {
  requireFinitePositive(config.lthrBpm, "lthrBpm");
  requireFinitePositive(config.hrLowBpm, "hrLowBpm");
  requireFinitePositive(config.hrHighBpm, "hrHighBpm");
  requireFinitePositive(config.paceLowSecPerKm, "paceLowSecPerKm");
  requireFinitePositive(config.paceHighSecPerKm, "paceHighSecPerKm");
  if (config.hrHighBpm < config.hrLowBpm) throw new Error("hrHighBpm cannot be lower than hrLowBpm.");
  if (config.paceHighSecPerKm < config.paceLowSecPerKm) {
    throw new Error("paceHighSecPerKm cannot be lower than paceLowSecPerKm.");
  }

  const pace = paceTarget(config.paceLowSecPerKm, config.paceHighSecPerKm);
  const hr = heartRateTarget(config.hrLowBpm, config.hrHighBpm);
  const manualLapPlaceholderSeconds = config.manualLapPlaceholderSeconds ?? 60;
  requireFinitePositive(manualLapPlaceholderSeconds, "manualLapPlaceholderSeconds");

  return [
    {
      id: "fenix5-time-auto",
      name: "F5 Validation - Time Auto",
      preset: {
        name: "F5 Validation - Time Auto",
        steps: [
          step("warmup", timeDuration(60), noTarget(), { name: "Warm-up" }),
          step("active", timeDuration(90), pace, { name: "Timed work" }),
          step("recovery", timeDuration(45), noTarget(), { name: "Recovery" }),
          step("cooldown", timeDuration(60), noTarget(), { name: "Cool-down" }),
        ],
      },
      candidateForKnownGood: true,
    },
    {
      id: "fenix5-distance-auto",
      name: "F5 Validation - Distance Auto",
      preset: {
        name: "F5 Validation - Distance Auto",
        steps: [
          step("active", distanceDuration(400), pace, { name: "400m work" }),
          step("recovery", distanceDuration(200), noTarget(), { name: "200m recovery" }),
        ],
      },
      candidateForKnownGood: true,
    },
    {
      id: "fenix5-repeat-pace",
      name: "F5 Validation - Repeats",
      preset: {
        name: "F5 Validation - Repeats",
        steps: [
          step("warmup", timeDuration(120), noTarget(), { name: "Warm-up" }),
          repeat(
            3,
            [
              step("active", distanceDuration(400), pace, { name: "400m work" }),
              step("recovery", timeDuration(45), noTarget(), { name: "Recovery" }),
            ],
            { name: "Main set" },
          ),
          step("cooldown", timeDuration(120), noTarget(), { name: "Cool-down" }),
        ],
      },
      candidateForKnownGood: true,
    },
    {
      id: "fenix5-hr-range",
      name: "F5 Validation - HR Range",
      preset: {
        name: "F5 Validation - HR Range",
        steps: [
          step("warmup", timeDuration(60), noTarget(), { name: "Warm-up" }),
          step("active", timeDuration(180), hr, { name: "HR range" }),
          step("cooldown", timeDuration(60), noTarget(), { name: "Cool-down" }),
        ],
      },
      translationConfig: {
        heartRateAnchor: { type: "lthr", bpm: config.lthrBpm },
      },
      candidateForKnownGood: true,
    },
    {
      id: "fenix5-manual-lap",
      name: "F5 Validation - Manual Lap",
      preset: {
        name: "F5 Validation - Manual Lap",
        steps: [
          step("warmup", manualLapDuration(), noTarget(), {
            name: "Warm-up until ready",
            instruction: "Press Lap when ready for the timed step.",
          }),
          step("active", timeDuration(60), pace, { name: "Timed work" }),
          step("cooldown", manualLapDuration(), noTarget(), {
            name: "Cool-down until done",
            instruction: "Press Lap when finished.",
          }),
        ],
      },
      translationConfig: { manualLapPlaceholderSeconds },
      candidateForKnownGood: true,
    },
  ] as const;
}
