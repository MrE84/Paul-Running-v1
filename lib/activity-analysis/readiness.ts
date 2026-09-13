import type { Activity } from "../domain/contracts";
import { extractGroups, getLaps, getRecords, normaliseDate, safeNumber } from "./core";
import type { Channel } from "./projection";

export type ActivityCompleteness = "complete" | "partial" | "summary_only" | "invalid";

export interface ActivityDataReadiness {
  state: ActivityCompleteness;
  recordCount: number;
  lapCount: number;
  gpsPointCount: number;
  channelCount: number;
  rawSectionCount: number;
  sourceFileHashAvailable: boolean;
  reasons: string[];
}

const channelFields: Record<Exclude<Channel, "pace" | "ambient_temperature" | "humidity" | "wind_speed" | "headwind" | "precipitation">, string[]> = {
  heart_rate: ["heart_rate"],
  cadence: ["cadence", "running_cadence"],
  altitude: ["enhanced_altitude", "altitude"],
  power: ["power"],
  speed: ["enhanced_speed", "speed"],
  grade: ["grade"],
  temperature: ["temperature"],
  vertical_oscillation: ["vertical_oscillation"],
  ground_contact_time: ["ground_contact_time", "stance_time"],
  respiration_rate: ["respiration_rate"],
};

function hasSummary(activity: Activity): boolean {
  return Object.values(activity.summary).some(value => typeof value === "number" && Number.isFinite(value));
}

export function assessActivityData(activity: Activity): ActivityDataReadiness {
  const normalized = activity.normalizedData;
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return {
      state: "invalid",
      recordCount: 0,
      lapCount: 0,
      gpsPointCount: 0,
      channelCount: 0,
      rawSectionCount: 0,
      sourceFileHashAvailable: Boolean(activity.sourceFileSha256),
      reasons: ["Stored activity data is invalid and should be repaired from the provider."],
    };
  }

  const records = getRecords(normalized);
  const laps = getLaps(normalized);
  const rawSectionCount = extractGroups(normalized).filter(group => group.count > 0).length;
  const gpsPointCount = records.filter(record => {
    const latitude = safeNumber(record.position_lat ?? record.latitude);
    const longitude = safeNumber(record.position_long ?? record.longitude);
    return latitude !== null && longitude !== null && !(latitude === 0 && longitude === 0);
  }).length;
  const channelCount = Object.values(channelFields).filter(fields =>
    records.some(record => fields.some(field => safeNumber(record[field]) !== null)),
  ).length;
  const timedRecords = records.filter(record => normaliseDate(record.timestamp) || safeNumber(record.elapsed_time) !== null).length;
  const reasons: string[] = [];
  let state: ActivityCompleteness;

  if (records.length === 0) {
    state = hasSummary(activity) ? "summary_only" : "invalid";
    reasons.push(state === "summary_only"
      ? "Summary is available, but detailed FIT records have not been restored."
      : "No usable summary or FIT records are stored.");
  } else if (records.length < 2 || timedRecords === 0 || channelCount === 0) {
    state = "partial";
    if (records.length < 2) reasons.push("Too few FIT records are available for timeline analysis.");
    if (timedRecords === 0) reasons.push("FIT records do not include usable timing.");
    if (channelCount === 0) reasons.push("FIT records do not include analyzable sensor channels.");
  } else {
    state = "complete";
  }

  if (!activity.sourceFileSha256) {
    if (state === "complete") state = "partial";
    reasons.push("The original file hash is not recorded.");
  }
  if (gpsPointCount === 0 && state === "complete") reasons.push("No GPS points are present; indoor analysis remains available.");
  if (laps.length === 0 && state === "complete") reasons.push("No laps are present; continuous analysis remains available.");

  return {
    state,
    recordCount: records.length,
    lapCount: laps.length,
    gpsPointCount,
    channelCount,
    rawSectionCount,
    sourceFileHashAvailable: Boolean(activity.sourceFileSha256),
    reasons,
  };
}

export function activityNeedsRepair(activity: Activity): boolean {
  return assessActivityData(activity).state !== "complete";
}
