import type { CapacityRevision, Sport, ZoneSet } from "../../domain/contracts";
import {
  IntervalsIcuClient,
  IntervalsIcuHttpError,
  type IntervalsIcuHeartRateSportSettings,
} from "./client";

const INTERVALS_ACTIVITY_TYPES: Partial<Record<Sport, string>> = {
  running: "Run",
  cycling: "Ride",
  walking: "Walk",
};

export class IntervalsZoneSyncError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "IntervalsZoneSyncError";
  }
}

/**
 * Map a canonical heart-rate zone set onto Intervals.icu sport settings. Intervals
 * stores only each zone's upper bound, so an open top zone is closed at max HR.
 */
export function toIntervalsHeartRateSettings(
  zoneSet: ZoneSet,
  capacity: CapacityRevision | undefined,
): { activityType: string; settings: IntervalsIcuHeartRateSportSettings } {
  if (zoneSet.targetType !== "heart_rate") {
    throw new IntervalsZoneSyncError("UNSUPPORTED_ZONE_TYPE", "Only heart-rate zones can be pushed to Intervals.icu.");
  }
  const activityType = INTERVALS_ACTIVITY_TYPES[zoneSet.sport];
  if (!activityType) {
    throw new IntervalsZoneSyncError("UNSUPPORTED_SPORT", `Sport ${zoneSet.sport} has no Intervals.icu sport settings mapping.`);
  }
  const zones = [...zoneSet.zones].sort((a, b) => a.zoneNumber - b.zoneNumber);
  const maxHr = capacity?.maxHrBpm;
  const hrZones = zones.map((zone, index) => {
    if (zone.upperBound !== undefined) return Math.round(zone.upperBound);
    if (index === zones.length - 1 && maxHr) return Math.round(maxHr);
    throw new IntervalsZoneSyncError("MAX_HR_REQUIRED", "The top zone is open-ended; set maxHrBpm so it can be closed for Intervals.icu.");
  });
  for (let index = 1; index < hrZones.length; index += 1) {
    if (hrZones[index] <= hrZones[index - 1]) {
      throw new IntervalsZoneSyncError("INVALID_ZONES", "Intervals.icu zone upper bounds must be strictly increasing.");
    }
  }
  const settings: IntervalsIcuHeartRateSportSettings = {
    hr_zones: hrZones,
    hr_zone_names: zones.map((zone) => zone.name),
  };
  if (capacity?.lt2HrBpm) settings.lthr = Math.round(capacity.lt2HrBpm);
  if (maxHr) settings.max_hr = Math.max(Math.round(maxHr), hrZones[hrZones.length - 1]);
  return { activityType, settings };
}

export type IntervalsZoneSyncResult =
  | { state: "sent"; activityType: string; settings: IntervalsIcuHeartRateSportSettings }
  | { state: "failed"; code: string; message: string };

export class IntervalsZoneSync {
  private readonly client: IntervalsIcuClient;

  constructor(config: { apiKey: string; intervalsAthleteId?: string; fetchImpl?: typeof fetch }) {
    this.client = new IntervalsIcuClient({
      auth: { type: "api_key", apiKey: config.apiKey },
      athleteId: config.intervalsAthleteId ?? "0",
      fetchImpl: config.fetchImpl,
    });
  }

  /** Never throws: the canonical zone set is already saved, so delivery failure is reported, not raised. */
  async push(zoneSet: ZoneSet, capacity: CapacityRevision | undefined): Promise<IntervalsZoneSyncResult> {
    try {
      const { activityType, settings } = toIntervalsHeartRateSettings(zoneSet, capacity);
      await this.client.updateHeartRateSportSettings(activityType, settings);
      return { state: "sent", activityType, settings };
    } catch (error) {
      if (error instanceof IntervalsZoneSyncError) return { state: "failed", code: error.code, message: error.message };
      if (error instanceof IntervalsIcuHttpError) {
        return { state: "failed", code: error.status === 429 ? "INTERVALS_RATE_LIMITED" : "INTERVALS_HTTP_ERROR", message: error.message };
      }
      return { state: "failed", code: "INTERVALS_ZONE_SYNC_FAILED", message: error instanceof Error ? error.message : String(error) };
    }
  }
}
