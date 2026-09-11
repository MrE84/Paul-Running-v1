import type {
  QaFinding,
  WorkoutExecutionStep,
  WorkoutRepeatStep,
  WorkoutRevision,
  WorkoutStep,
  WorkoutTargetType,
  ZoneSet,
} from "../domain/contracts";
import { summarizeWorkout } from "../workouts/summary";
import type {
  PaceArithmetic,
  WorkoutQaContext,
  WorkoutQaReport,
  WorkoutSyncCandidate,
} from "./contracts";

const DEFAULT_MAX_RUNNING_DURATION_SECONDS = 8 * 60 * 60;
const DEFAULT_MAX_RUNNING_DISTANCE_METERS = 100_000;
const ARITHMETIC_TOLERANCE_SECONDS = 1;
const ARITHMETIC_TOLERANCE_METERS = 1;

const expectedTargetUnits: Record<Exclude<WorkoutTargetType, "none">, string> = {
  heart_rate: "bpm",
  pace: "sec_per_km",
  cadence: "spm",
  power: "watts",
};

function finding(
  findings: QaFinding[],
  severity: QaFinding["severity"],
  code: string,
  path: string,
  message: string,
): void {
  findings.push({ severity, code, path, message });
}

function isFinitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function executionStepCount(step: WorkoutStep): number {
  if (step.kind === "step") return 1;
  return step.repeatCount * step.children.reduce((sum, child) => sum + executionStepCount(child), 0);
}

function matchingZoneSets(
  workout: WorkoutRevision,
  targetType: WorkoutTargetType,
  zoneSets: readonly ZoneSet[] | undefined,
): ZoneSet[] {
  if (!zoneSets || targetType === "none") return [];
  return zoneSets.filter(
    (set) => set.sport === workout.sport && set.targetType === targetType,
  );
}

function validateTargetAgainstZones(
  workout: WorkoutRevision,
  step: WorkoutExecutionStep,
  path: string,
  context: WorkoutQaContext,
  findings: QaFinding[],
): void {
  if (step.targetType === "none") return;
  const sets = matchingZoneSets(workout, step.targetType, context.zoneSets);
  if (sets.length === 0 || step.targetLow === undefined || step.targetHigh === undefined) return;

  const zones = sets.flatMap((set) => set.zones);
  const units = new Set(zones.map((zone) => zone.unit).filter(Boolean));
  if (step.targetUnit && units.size > 0 && !units.has(step.targetUnit)) {
    finding(
      findings,
      "error",
      "TARGET_ZONE_UNIT_MISMATCH",
      `${path}.targetUnit`,
      `Target unit ${step.targetUnit} does not match the configured ${step.targetType} zone units.`,
    );
    return;
  }

  const hasOpenLowerBound = zones.some((zone) => zone.lowerBound === undefined);
  const hasOpenUpperBound = zones.some((zone) => zone.upperBound === undefined);
  const lowerBounds = zones
    .map((zone) => zone.lowerBound)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const upperBounds = zones
    .map((zone) => zone.upperBound)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));

  const minimum = hasOpenLowerBound || lowerBounds.length === 0 ? undefined : Math.min(...lowerBounds);
  const maximum = hasOpenUpperBound || upperBounds.length === 0 ? undefined : Math.max(...upperBounds);

  if (minimum !== undefined && step.targetHigh < minimum) {
    finding(
      findings,
      "error",
      "TARGET_BELOW_CONFIGURED_ZONES",
      path,
      `Target ${step.targetLow}-${step.targetHigh} ${step.targetUnit ?? ""} is below the configured zone range beginning at ${minimum}.`,
    );
  }
  if (maximum !== undefined && step.targetLow > maximum) {
    finding(
      findings,
      "error",
      "TARGET_ABOVE_CONFIGURED_ZONES",
      path,
      `Target ${step.targetLow}-${step.targetHigh} ${step.targetUnit ?? ""} is above the configured zone range ending at ${maximum}.`,
    );
  }
}

function validateExecutionStep(
  workout: WorkoutRevision,
  step: WorkoutExecutionStep,
  path: string,
  context: WorkoutQaContext,
  findings: QaFinding[],
): void {
  if (step.durationType === "open") {
    if (step.durationValue !== undefined || step.durationUnit !== undefined) {
      finding(
        findings,
        "error",
        "OPEN_STEP_HAS_FIXED_DURATION",
        path,
        "Manual-Lap/open steps must not also contain a fixed duration value or unit.",
      );
    }
    if (context.deliveryProfile?.requireExplicitManualLapIntent && step.manualLapIntent !== true) {
      finding(
        findings,
        "error",
        "MANUAL_LAP_INTENT_REQUIRED",
        `${path}.manualLapIntent`,
        "This open step would wait for a Lap press, but explicit manual-Lap intent was not recorded.",
      );
    }
  } else {
    if (!isFinitePositive(step.durationValue)) {
      finding(
        findings,
        "error",
        "INVALID_DURATION_VALUE",
        `${path}.durationValue`,
        "Automatic workout steps require a finite duration greater than zero.",
      );
    }
    const expectedUnit = step.durationType === "time" ? "seconds" : "meters";
    if (step.durationUnit !== expectedUnit) {
      finding(
        findings,
        "error",
        "INVALID_DURATION_UNIT",
        `${path}.durationUnit`,
        `${step.durationType} steps must use ${expectedUnit}.`,
      );
    }
    if (step.manualLapIntent === true) {
      finding(
        findings,
        "error",
        "MANUAL_LAP_INTENT_ON_AUTOMATIC_STEP",
        `${path}.manualLapIntent`,
        "Time and distance steps auto-advance and cannot also be marked as intentional manual-Lap steps.",
      );
    }
  }

  const supportedDurations = context.deliveryProfile?.supportedDurationTypes;
  if (supportedDurations && !supportedDurations.includes(step.durationType)) {
    finding(
      findings,
      "error",
      "UNSUPPORTED_DELIVERY_DURATION",
      `${path}.durationType`,
      `${context.deliveryProfile?.provider ?? "Delivery provider"} does not support ${step.durationType} workout steps.`,
    );
  }

  if (step.targetType === "none") {
    if (
      step.targetLow !== undefined ||
      step.targetHigh !== undefined ||
      step.targetUnit !== undefined
    ) {
      finding(
        findings,
        "error",
        "NONE_TARGET_HAS_BOUNDS",
        path,
        "A targetType of none cannot contain target bounds or a target unit.",
      );
    }
    return;
  }

  if (!isFinitePositive(step.targetLow) || !isFinitePositive(step.targetHigh)) {
    finding(
      findings,
      "error",
      "INVALID_TARGET_BOUNDS",
      path,
      `${step.targetType} targets require finite positive lower and upper bounds.`,
    );
  } else if (step.targetHigh < step.targetLow) {
    finding(
      findings,
      "error",
      "TARGET_RANGE_REVERSED",
      path,
      `${step.targetType} target upper bound cannot be lower than the lower bound.`,
    );
  }

  const expectedUnit = expectedTargetUnits[step.targetType];
  if (step.targetUnit !== expectedUnit) {
    finding(
      findings,
      "error",
      "INVALID_TARGET_UNIT",
      `${path}.targetUnit`,
      `${step.targetType} targets must use ${expectedUnit}.`,
    );
  }

  const supportedTargets = context.deliveryProfile?.supportedTargetTypes;
  if (supportedTargets && !supportedTargets.includes(step.targetType)) {
    finding(
      findings,
      "error",
      "UNSUPPORTED_DELIVERY_TARGET",
      `${path}.targetType`,
      `${context.deliveryProfile?.provider ?? "Delivery provider"} does not support ${step.targetType} targets.`,
    );
  }

  if (
    step.targetType === "heart_rate" &&
    step.targetLow !== undefined &&
    step.targetHigh !== undefined
  ) {
    const maxHr = context.capacity?.maxHrBpm;
    const restingHr = context.capacity?.restingHrBpm;
    if (maxHr !== undefined && step.targetHigh > maxHr) {
      finding(
        findings,
        "error",
        "HR_TARGET_ABOVE_MAX",
        path,
        `Heart-rate target ends at ${step.targetHigh} bpm, above configured max HR ${maxHr} bpm.`,
      );
    }
    if (restingHr !== undefined && step.targetHigh < restingHr) {
      finding(
        findings,
        "error",
        "HR_TARGET_BELOW_RESTING",
        path,
        `Heart-rate target ends below configured resting HR ${restingHr} bpm.`,
      );
    }
  }

  validateTargetAgainstZones(workout, step, path, context, findings);

  if (
    step.durationType === "distance" &&
    step.targetType === "pace" &&
    isFinitePositive(step.durationValue) &&
    isFinitePositive(step.targetLow) &&
    isFinitePositive(step.targetHigh)
  ) {
    const projected = context.syncProjection?.steps[step.id];
    if (projected) {
      const expected = calculatePaceArithmetic(
        step.durationValue,
        step.targetLow,
        step.targetHigh,
      );
      if (
        projected.durationSeconds !== undefined &&
        (projected.durationSeconds < expected.minDurationSeconds - ARITHMETIC_TOLERANCE_SECONDS ||
          projected.durationSeconds > expected.maxDurationSeconds + ARITHMETIC_TOLERANCE_SECONDS)
      ) {
        finding(
          findings,
          "error",
          "PACE_DISTANCE_DURATION_MISMATCH",
          path,
          `Connector duration ${projected.durationSeconds}s does not match distance × pace (${expected.minDurationSeconds.toFixed(1)}-${expected.maxDurationSeconds.toFixed(1)}s).`,
        );
      }
      if (
        projected.distanceMeters !== undefined &&
        Math.abs(projected.distanceMeters - step.durationValue) > ARITHMETIC_TOLERANCE_METERS
      ) {
        finding(
          findings,
          "error",
          "SYNC_DISTANCE_MISMATCH",
          path,
          `Connector distance ${projected.distanceMeters}m does not match canonical distance ${step.durationValue}m.`,
        );
      }
    }
  }
}

function validateRepeatStep(
  workout: WorkoutRevision,
  step: WorkoutRepeatStep,
  path: string,
  depth: number,
  context: WorkoutQaContext,
  findings: QaFinding[],
): void {
  if (!Number.isInteger(step.repeatCount) || step.repeatCount < 1) {
    finding(
      findings,
      "error",
      "INVALID_REPEAT_COUNT",
      `${path}.repeatCount`,
      "Repeat count must be a positive integer.",
    );
  }
  if (step.children.length === 0) {
    finding(
      findings,
      "error",
      "EMPTY_REPEAT_BLOCK",
      `${path}.children`,
      "Repeat blocks must contain at least one child step.",
    );
  }
  const maxDepth = context.deliveryProfile?.maxRepeatDepth;
  if (maxDepth !== undefined && depth > maxDepth) {
    finding(
      findings,
      "error",
      "DELIVERY_REPEAT_DEPTH_EXCEEDED",
      path,
      `${context.deliveryProfile?.provider ?? "Delivery provider"} supports repeat depth ${maxDepth}, but this block is at depth ${depth}.`,
    );
  }
  step.children.forEach((child, index) =>
    validateNode(workout, child, `${path}.children[${index}]`, depth + 1, context, findings),
  );
}

function validateNode(
  workout: WorkoutRevision,
  step: WorkoutStep,
  path: string,
  depth: number,
  context: WorkoutQaContext,
  findings: QaFinding[],
): void {
  if (step.kind === "step") {
    validateExecutionStep(workout, step, path, context, findings);
  } else {
    validateRepeatStep(workout, step, path, depth, context, findings);
  }
}

function validateSequence(steps: readonly WorkoutStep[], path: string, findings: QaFinding[]): void {
  steps.forEach((step, index) => {
    if (step.sequence !== index) {
      finding(
        findings,
        "error",
        "INVALID_STEP_SEQUENCE",
        `${path}[${index}].sequence`,
        `Step sequence must be ${index}, received ${step.sequence}.`,
      );
    }
    if (step.kind === "repeat") validateSequence(step.children, `${path}[${index}].children`, findings);
  });
}

function localParts(instant: string, timezone: string): { date: string; time: string } | undefined {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(parsed);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const year = value("year");
    const month = value("month");
    const day = value("day");
    const hour = value("hour");
    const minute = value("minute");
    if (!year || !month || !day || !hour || !minute) return undefined;
    return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
  } catch {
    return undefined;
  }
}

function validateCalendar(
  workout: WorkoutRevision,
  context: WorkoutQaContext,
  findings: QaFinding[],
): void {
  const item = context.calendarItem;
  if (!item) return;

  if (item.workout.id !== workout.workoutId || item.workout.version !== workout.version) {
    finding(
      findings,
      "error",
      "CALENDAR_WORKOUT_REVISION_MISMATCH",
      "calendarItem.workout",
      "Calendar item does not reference the workout revision being validated.",
    );
  }
  if (item.status !== "planned") {
    finding(
      findings,
      "error",
      "CALENDAR_ITEM_NOT_SYNCABLE",
      "calendarItem.status",
      `Only planned calendar items can be published; current status is ${item.status}.`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.scheduledLocalDate)) {
    finding(findings, "error", "INVALID_LOCAL_DATE", "calendarItem.scheduledLocalDate", "Local date must use YYYY-MM-DD.");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(item.scheduledLocalTime)) {
    finding(findings, "error", "INVALID_LOCAL_TIME", "calendarItem.scheduledLocalTime", "Local time must use 24-hour HH:mm or HH:mm:ss.");
  }

  const local = localParts(item.scheduledStart, item.timezone);
  if (!local) {
    finding(
      findings,
      "error",
      "INVALID_SCHEDULED_INSTANT_OR_TIMEZONE",
      "calendarItem.scheduledStart",
      "scheduledStart or timezone is invalid and cannot be converted to local time.",
    );
    return;
  }
  if (local.date !== item.scheduledLocalDate) {
    finding(
      findings,
      "error",
      "SCHEDULED_LOCAL_DATE_MISMATCH",
      "calendarItem.scheduledLocalDate",
      `Stored local date ${item.scheduledLocalDate} does not match ${item.scheduledStart} in ${item.timezone} (${local.date}).`,
    );
  }
  if (local.time !== item.scheduledLocalTime.slice(0, 5)) {
    finding(
      findings,
      "error",
      "SCHEDULED_LOCAL_TIME_MISMATCH",
      "calendarItem.scheduledLocalTime",
      `Stored local time ${item.scheduledLocalTime} does not match ${item.scheduledStart} in ${item.timezone} (${local.time}).`,
    );
  }
}

function validateSensibleTotals(
  workout: WorkoutRevision,
  context: WorkoutQaContext,
  findings: QaFinding[],
): void {
  const summary = summarizeWorkout(workout);
  const maxDuration =
    context.maxSensibleDurationSeconds ??
    (workout.sport === "running" ? DEFAULT_MAX_RUNNING_DURATION_SECONDS : undefined);
  const maxDistance =
    context.maxSensibleDistanceMeters ??
    (workout.sport === "running" ? DEFAULT_MAX_RUNNING_DISTANCE_METERS : undefined);

  if (maxDuration !== undefined && summary.totalDurationSeconds?.max !== undefined && summary.totalDurationSeconds.max > maxDuration) {
    finding(
      findings,
      "warning",
      "UNUSUALLY_LONG_WORKOUT_DURATION",
      "workout.steps",
      `Calculated workout duration can reach ${Math.round(summary.totalDurationSeconds.max)}s, above the configured sensible limit ${maxDuration}s.`,
    );
  }
  if (maxDistance !== undefined && summary.totalDistanceMeters?.max !== undefined && summary.totalDistanceMeters.max > maxDistance) {
    finding(
      findings,
      "warning",
      "UNUSUALLY_LONG_WORKOUT_DISTANCE",
      "workout.steps",
      `Calculated workout distance can reach ${Math.round(summary.totalDistanceMeters.max)}m, above the configured sensible limit ${maxDistance}m.`,
    );
  }

  const expandedSteps = workout.steps.reduce((sum, step) => sum + executionStepCount(step), 0);
  const maxExpanded = context.deliveryProfile?.maxExpandedExecutionSteps;
  if (maxExpanded !== undefined && expandedSteps > maxExpanded) {
    finding(
      findings,
      "error",
      "DELIVERY_STEP_LIMIT_EXCEEDED",
      "workout.steps",
      `${context.deliveryProfile?.provider ?? "Delivery provider"} supports at most ${maxExpanded} executable steps; this workout expands to ${expandedSteps}.`,
    );
  }
}

export function calculatePaceArithmetic(
  distanceMeters: number,
  lowSecPerKm: number,
  highSecPerKm: number = lowSecPerKm,
): PaceArithmetic {
  return {
    minDurationSeconds: (distanceMeters / 1000) * lowSecPerKm,
    maxDurationSeconds: (distanceMeters / 1000) * highSecPerKm,
  };
}

export function validateWorkoutForSync(candidate: WorkoutSyncCandidate): WorkoutQaReport {
  const { workout, context } = candidate;
  const findings: QaFinding[] = [];

  if (!workout.workoutId) {
    finding(findings, "error", "WORKOUT_ID_REQUIRED", "workout.workoutId", "Workout ID is required.");
  }
  if (!Number.isInteger(workout.version) || workout.version < 1) {
    finding(findings, "error", "INVALID_WORKOUT_VERSION", "workout.version", "Workout version must be a positive integer.");
  }
  if (!workout.name.trim()) {
    finding(findings, "error", "WORKOUT_NAME_REQUIRED", "workout.name", "Workout name is required.");
  }
  if (workout.steps.length === 0) {
    finding(findings, "error", "WORKOUT_STEPS_REQUIRED", "workout.steps", "Workout must contain at least one step.");
  }

  validateSequence(workout.steps, "workout.steps", findings);
  workout.steps.forEach((step, index) =>
    validateNode(workout, step, `workout.steps[${index}]`, 1, context, findings),
  );
  validateCalendar(workout, context, findings);
  validateSensibleTotals(workout, context, findings);

  const errorCount = findings.filter((item) => item.severity === "error").length;
  const warningCount = findings.length - errorCount;
  return {
    valid: errorCount === 0,
    findings,
    errorCount,
    warningCount,
  };
}

export class WorkoutQaError extends Error {
  readonly report: WorkoutQaReport;

  constructor(report: WorkoutQaReport) {
    super(`Workout QA failed with ${report.errorCount} error(s).`);
    this.name = "WorkoutQaError";
    this.report = report;
  }
}

export function assertWorkoutReadyForSync(candidate: WorkoutSyncCandidate): WorkoutQaReport {
  const report = validateWorkoutForSync(candidate);
  if (!report.valid) throw new WorkoutQaError(report);
  return report;
}
