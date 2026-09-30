import {
  DEBRIEF_LIMITS,
  DEBRIEF_SOURCES,
  DEBRIEF_TEXT_FIELDS,
  type ActivityDebrief,
  type SaveDebriefInput,
} from "./contracts";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export interface DebriefProblem { field: string; message: string }

/** Returns every problem with the input; an empty array means it is valid. */
export function validateSaveDebriefInput(input: SaveDebriefInput, now: string): DebriefProblem[] {
  const problems: DebriefProblem[] = [];
  const raw = input as Record<string, unknown>;

  if (raw.rpe !== undefined && raw.rpe !== null) {
    const rpe = raw.rpe;
    const steps = typeof rpe === "number" ? rpe / DEBRIEF_LIMITS.rpeStep : NaN;
    if (typeof rpe !== "number" || !Number.isFinite(rpe) || rpe < DEBRIEF_LIMITS.rpeMin || rpe > DEBRIEF_LIMITS.rpeMax || !Number.isInteger(steps)) {
      problems.push({ field: "rpe", message: `rpe must be a number from ${DEBRIEF_LIMITS.rpeMin} to ${DEBRIEF_LIMITS.rpeMax} in steps of ${DEBRIEF_LIMITS.rpeStep}.` });
    }
  }

  for (const field of DEBRIEF_TEXT_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") problems.push({ field, message: `${field} must be text.` });
    else if (value.length > DEBRIEF_LIMITS.textMaxLength) problems.push({ field, message: `${field} must be at most ${DEBRIEF_LIMITS.textMaxLength} characters.` });
  }

  if (raw.source !== undefined && !DEBRIEF_SOURCES.includes(raw.source as never)) {
    problems.push({ field: "source", message: `source must be one of ${DEBRIEF_SOURCES.join(", ")}.` });
  }

  if (raw.recordedAt !== undefined) {
    const value = raw.recordedAt;
    const parsed = typeof value === "string" && ISO_TIMESTAMP.test(value) ? Date.parse(value) : NaN;
    if (!Number.isFinite(parsed)) problems.push({ field: "recordedAt", message: "recordedAt must be an ISO 8601 timestamp with a time zone." });
    else if (parsed > Date.parse(now) + 24 * 3_600_000) problems.push({ field: "recordedAt", message: "recordedAt cannot be in the future." });
  }

  if (raw.expectedVersion !== undefined && (typeof raw.expectedVersion !== "number" || !Number.isInteger(raw.expectedVersion) || raw.expectedVersion < 0)) {
    problems.push({ field: "expectedVersion", message: "expectedVersion must be a non-negative integer." });
  }
  return problems;
}

/** A debrief must say something: an RPE or at least one non-empty text field. */
export function hasDebriefContent(debrief: Pick<ActivityDebrief, "rpe" | (typeof DEBRIEF_TEXT_FIELDS)[number]>): boolean {
  return debrief.rpe !== undefined || DEBRIEF_TEXT_FIELDS.some((field) => Boolean(debrief[field]));
}

/**
 * Merge input over the current debrief. Omitted fields carry forward; null or blank text
 * clears a field. Text is trimmed.
 */
export function mergeDebriefFields(current: ActivityDebrief | undefined, input: SaveDebriefInput) {
  const merged: Partial<Record<"rpe" | (typeof DEBRIEF_TEXT_FIELDS)[number], number | string>> = {};
  const rpe = input.rpe === undefined ? current?.rpe : input.rpe === null ? undefined : input.rpe;
  if (rpe !== undefined) merged.rpe = rpe;
  for (const field of DEBRIEF_TEXT_FIELDS) {
    const next = input[field] === undefined ? current?.[field] : input[field]?.trim();
    if (next) merged[field] = next;
  }
  return merged as Pick<ActivityDebrief, "rpe" | (typeof DEBRIEF_TEXT_FIELDS)[number]>;
}
