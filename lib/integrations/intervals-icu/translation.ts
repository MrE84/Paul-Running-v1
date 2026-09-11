import type {
  CanonicalScheduledWorkout,
  Sport,
  WorkoutExecutionStep,
  WorkoutRevision,
  WorkoutStep,
  WorkoutTargetType,
} from "../../domain/contracts";
import type { DeliveryProfile, SyncProjection } from "../../qa/contracts";
import { calculatePaceArithmetic } from "../../qa/engine";
import type { IntervalsIcuEventPayload } from "./client";

export interface IntervalsIcuHeartRateAnchor {
  type: "max_hr" | "lthr";
  bpm: number;
}

export interface IntervalsIcuTranslationConfig {
  externalIdPrefix?: string;
  heartRateAnchor?: IntervalsIcuHeartRateAnchor;
  manualLapPlaceholderSeconds?: number;
  allowMixedTargetTypes?: boolean;
}

export interface IntervalsIcuTranslation {
  event: IntervalsIcuEventPayload;
  deliveryProfile: DeliveryProfile;
  syncProjection: SyncProjection;
  localDate: string;
  localTime: string;
  warnings: string[];
}

export class IntervalsIcuTranslationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(message);
    this.name = "IntervalsIcuTranslationError";
    this.code = code;
    this.path = path;
  }
}

export const INTERVALS_ICU_DELIVERY_PROFILE: DeliveryProfile = {
  id: "intervals-icu-garmin-v1",
  provider: "intervals_icu",
  supportedDurationTypes: ["time", "distance", "open"],
  supportedTargetTypes: ["none", "heart_rate", "pace", "cadence", "power"],
  maxRepeatDepth: 1,
  maxExpandedExecutionSteps: 50,
  requireExplicitManualLapIntent: true,
};

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new IntervalsIcuTranslationError(
      "INVALID_TIME_DURATION",
      "durationValue",
      "Intervals.icu time durations must be finite and greater than zero.",
    );
  }
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return [
    hours > 0 ? `${hours}h` : "",
    minutes > 0 ? `${minutes}m` : "",
    secs > 0 ? `${secs}s` : "",
  ].join("") || "1s";
}

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) {
    throw new IntervalsIcuTranslationError(
      "INVALID_DISTANCE_DURATION",
      "durationValue",
      "Intervals.icu distance durations must be finite and greater than zero.",
    );
  }
  if (meters >= 1000 && Math.abs(meters / 1000 - Math.round((meters / 1000) * 10) / 10) < 1e-9) {
    return `${Math.round((meters / 1000) * 10) / 10}km`;
  }
  return `${Math.round(meters)}mtr`;
}

function formatPace(secondsPerKm: number): string {
  const rounded = Math.round(secondsPerKm);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function sanitizeCue(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function renderTarget(
  step: WorkoutExecutionStep,
  config: IntervalsIcuTranslationConfig,
  path: string,
): string {
  if (step.targetType === "none") return "";
  if (step.targetLow === undefined || step.targetHigh === undefined) {
    throw new IntervalsIcuTranslationError(
      "TARGET_RANGE_REQUIRED",
      path,
      `Intervals.icu requires both bounds for ${step.targetType} targets.`,
    );
  }

  const low = step.targetLow;
  const high = step.targetHigh;
  switch (step.targetType) {
    case "pace": {
      if (step.targetUnit !== "sec_per_km") {
        throw new IntervalsIcuTranslationError(
          "UNSUPPORTED_PACE_UNIT",
          path,
          `Intervals.icu v1 translation expects sec_per_km pace, received ${step.targetUnit ?? "none"}.`,
        );
      }
      const value = low === high ? formatPace(low) : `${formatPace(low)}-${formatPace(high)}`;
      return `${value}/km Pace`;
    }
    case "heart_rate": {
      if (step.targetUnit !== "bpm") {
        throw new IntervalsIcuTranslationError(
          "UNSUPPORTED_HEART_RATE_UNIT",
          path,
          `Intervals.icu v1 translation expects bpm heart-rate targets, received ${step.targetUnit ?? "none"}.`,
        );
      }
      const anchor = config.heartRateAnchor;
      if (!anchor || !Number.isFinite(anchor.bpm) || anchor.bpm <= 0) {
        throw new IntervalsIcuTranslationError(
          "HEART_RATE_ANCHOR_REQUIRED",
          path,
          "Intervals.icu cannot prescribe absolute BPM directly. Configure a max-HR or LTHR anchor so canonical BPM targets can be converted explicitly.",
        );
      }
      const lowPercent = (low / anchor.bpm) * 100;
      const highPercent = (high / anchor.bpm) * 100;
      const range =
        Math.abs(lowPercent - highPercent) < 1e-9
          ? formatPercent(lowPercent)
          : `${formatPercent(lowPercent)}-${formatPercent(highPercent)}`;
      return `${range}% ${anchor.type === "lthr" ? "LTHR" : "HR"}`;
    }
    case "power": {
      if (step.targetUnit !== "watts") {
        throw new IntervalsIcuTranslationError(
          "UNSUPPORTED_POWER_UNIT",
          path,
          `Intervals.icu v1 translation expects watts, received ${step.targetUnit ?? "none"}.`,
        );
      }
      return low === high ? `${Math.round(low)}w` : `${Math.round(low)}-${Math.round(high)}w`;
    }
    case "cadence": {
      if (step.targetUnit !== "spm") {
        throw new IntervalsIcuTranslationError(
          "UNSUPPORTED_CADENCE_UNIT",
          path,
          `Intervals.icu v1 translation expects canonical running cadence in spm, received ${step.targetUnit ?? "none"}.`,
        );
      }
      return low === high ? `${Math.round(low)}rpm` : `${Math.round(low)}-${Math.round(high)}rpm`;
    }
  }
}

function renderExecutionStep(
  step: WorkoutExecutionStep,
  config: IntervalsIcuTranslationConfig,
  path: string,
  warnings: string[],
): string {
  let duration: string;
  let prefix = "";
  if (step.durationType === "time") {
    if (step.durationUnit !== "seconds" || step.durationValue === undefined) {
      throw new IntervalsIcuTranslationError(
        "INVALID_TIME_DURATION",
        path,
        "Canonical time steps must use seconds before Intervals.icu translation.",
      );
    }
    duration = formatSeconds(step.durationValue);
  } else if (step.durationType === "distance") {
    if (step.durationUnit !== "meters" || step.durationValue === undefined) {
      throw new IntervalsIcuTranslationError(
        "INVALID_DISTANCE_DURATION",
        path,
        "Canonical distance steps must use meters before Intervals.icu translation.",
      );
    }
    duration = formatDistance(step.durationValue);
  } else {
    if (step.manualLapIntent !== true) {
      throw new IntervalsIcuTranslationError(
        "MANUAL_LAP_INTENT_REQUIRED",
        path,
        "Open steps are only translated when manual-Lap intent is explicit.",
      );
    }
    const placeholder = config.manualLapPlaceholderSeconds ?? 60;
    duration = formatSeconds(placeholder);
    prefix = "Press lap when ready ";
    warnings.push(
      `Open step ${step.id} uses a ${placeholder}s Intervals.icu placeholder for load calculation; Garmin advances it by Lap press.`,
    );
  }

  const cue = sanitizeCue(step.name ?? step.instruction);
  const target = renderTarget(step, config, path);
  return `- ${prefix}${cue ? `${cue} ` : ""}${duration}${target ? ` ${target}` : ""}`;
}

function collectTargetTypes(steps: readonly WorkoutStep[], result = new Set<WorkoutTargetType>()): Set<WorkoutTargetType> {
  for (const step of steps) {
    if (step.kind === "step") {
      if (step.targetType !== "none") result.add(step.targetType);
    } else {
      collectTargetTypes(step.children, result);
    }
  }
  return result;
}

function renderNodes(
  steps: readonly WorkoutStep[],
  config: IntervalsIcuTranslationConfig,
  path: string,
  depth: number,
  warnings: string[],
): string[] {
  const lines: string[] = [];
  steps.forEach((step, index) => {
    const stepPath = `${path}[${index}]`;
    if (step.kind === "step") {
      lines.push(renderExecutionStep(step, config, stepPath, warnings));
      return;
    }
    if (depth > 1) {
      throw new IntervalsIcuTranslationError(
        "NESTED_REPEATS_UNSUPPORTED",
        stepPath,
        "Intervals.icu workout text does not support nested repeats.",
      );
    }
    if (!Number.isInteger(step.repeatCount) || step.repeatCount < 1) {
      throw new IntervalsIcuTranslationError(
        "INVALID_REPEAT_COUNT",
        `${stepPath}.repeatCount`,
        "Repeat count must be a positive integer.",
      );
    }
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    const repeatName = sanitizeCue(step.name);
    lines.push(`${repeatName ? `${repeatName} ` : ""}${step.repeatCount}x`);
    lines.push(...renderNodes(step.children, config, `${stepPath}.children`, depth + 1, warnings));
    lines.push("");
  });
  while (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function localDateTime(instant: string, timezone: string): { date: string; time: string; value: string } {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new IntervalsIcuTranslationError(
      "INVALID_SCHEDULED_START",
      "calendarItem.scheduledStart",
      `Invalid scheduledStart value: ${instant}`,
    );
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    throw new IntervalsIcuTranslationError(
      "INVALID_TIMEZONE",
      "calendarItem.timezone",
      `Invalid IANA timezone: ${timezone}`,
    );
  }
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  const second = value("second");
  if (!year || !month || !day || !hour || !minute || !second) {
    throw new IntervalsIcuTranslationError(
      "LOCAL_TIME_RESOLUTION_FAILED",
      "calendarItem.scheduledStart",
      "Could not resolve scheduledStart into the configured local timezone.",
    );
  }
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}:${second}`,
    value: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
  };
}

function intervalsSport(sport: Sport): string {
  switch (sport) {
    case "running":
      return "Run";
    case "cycling":
      return "Ride";
    case "walking":
      return "Walk";
    default:
      return "Other";
  }
}

function projectionForWorkout(workout: WorkoutRevision): SyncProjection {
  const projections: SyncProjection["steps"] extends Readonly<Record<string, infer T>> ? Record<string, T> : never = {};
  const visit = (steps: readonly WorkoutStep[]) => {
    for (const step of steps) {
      if (step.kind === "repeat") {
        visit(step.children);
        continue;
      }
      if (
        step.durationType === "distance" &&
        step.durationUnit === "meters" &&
        step.durationValue !== undefined &&
        step.targetType === "pace" &&
        step.targetUnit === "sec_per_km" &&
        step.targetLow !== undefined &&
        step.targetHigh !== undefined
      ) {
        const arithmetic = calculatePaceArithmetic(
          step.durationValue,
          step.targetLow,
          step.targetHigh,
        );
        projections[step.id] = {
          distanceMeters: step.durationValue,
          durationSeconds: (arithmetic.minDurationSeconds + arithmetic.maxDurationSeconds) / 2,
        };
      }
    }
  };
  visit(workout.steps);
  return { provider: "intervals_icu", steps: projections };
}

export function translateScheduledWorkout(
  input: CanonicalScheduledWorkout,
  config: IntervalsIcuTranslationConfig = {},
): IntervalsIcuTranslation {
  const targetTypes = collectTargetTypes(input.workout.steps);
  if (!config.allowMixedTargetTypes && targetTypes.size > 1) {
    throw new IntervalsIcuTranslationError(
      "MIXED_TARGET_TYPES_UNSAFE",
      "workout.steps",
      `Intervals.icu delivery is currently gated to one target family per workout; found ${[...targetTypes].join(", ")}.`,
    );
  }

  const warnings: string[] = [];
  const lines = renderNodes(input.workout.steps, config, "workout.steps", 1, warnings);
  const local = localDateTime(input.calendarItem.scheduledStart, input.calendarItem.timezone);
  const prefix = config.externalIdPrefix ?? "paul-running";

  return {
    event: {
      category: "WORKOUT",
      start_date_local: local.value,
      type: intervalsSport(input.workout.sport),
      name: input.workout.name,
      description: lines.join("\n"),
      external_id: `${prefix}:${input.calendarItem.id}`,
    },
    deliveryProfile: INTERVALS_ICU_DELIVERY_PROFILE,
    syncProjection: projectionForWorkout(input.workout),
    localDate: local.date,
    localTime: local.time,
    warnings,
  };
}
